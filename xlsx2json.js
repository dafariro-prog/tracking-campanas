const fs=require('fs'),zlib=require('zlib');
function readZip(buf){const files={};let o=0;while(o<buf.length){const sig=buf.readUInt32LE(o);if(sig!==0x04034b50)break;const method=buf.readUInt16LE(o+8);const compSize=buf.readUInt32LE(o+18);const nameLen=buf.readUInt16LE(o+26);const extraLen=buf.readUInt16LE(o+28);const name=buf.toString('utf8',o+30,o+30+nameLen);const dataStart=o+30+nameLen+extraLen;const comp=buf.slice(dataStart,dataStart+compSize);let data;try{data=method===8?zlib.inflateRawSync(comp):comp;}catch(e){data=Buffer.alloc(0);}files[name]=data;o=dataStart+compSize;}return files;}
const dec=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
const files=readZip(fs.readFileSync(process.argv[2]));
const ssXml=(files['xl/sharedStrings.xml']||Buffer.alloc(0)).toString('utf8');
const shared=[];
ssXml.replace(/<si>([\s\S]*?)<\/si>/g,(_,si)=>{const parts=[];si.replace(/<t[^>]*>([\s\S]*?)<\/t>/g,(__,t)=>{parts.push(t);return '';});shared.push(dec(parts.join('')));return '';});
const sh=files['xl/worksheets/sheet1.xml'].toString('utf8');
const colNum=ref=>{const m=ref.match(/^([A-Z]+)/)[1];let n=0;for(const ch of m)n=n*26+(ch.charCodeAt(0)-64);return n-1;};
const rows=[];
sh.replace(/<row[^>]*>([\s\S]*?)<\/row>/g,(_,rowXml)=>{const cells=[];rowXml.replace(/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g,(__,ref,attrs,inner)=>{const ci=colNum(ref);const isStr=/t="s"/.test(attrs);let val='';const vm=inner.match(/<v>([\s\S]*?)<\/v>/);if(vm){val=isStr?shared[+vm[1]]:vm[1];}else{const tm=inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);if(tm)val=dec(tm[1]);}cells[ci]=val;return '';});rows.push(cells);return '';});
fs.writeFileSync(process.argv[3]||'homolog_rows.json',JSON.stringify(rows));
console.log('Filas:',rows.length,'| Encabezados:',JSON.stringify(rows[0]));
