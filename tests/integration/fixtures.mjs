/** Original synthetic fixtures. No experimental images or vendor data are read. */
import { deflateSync } from 'node:zlib';
function chunk(type, data) {
  const body=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
  for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}
  const size=Buffer.alloc(4);size.writeUInt32BE(data.length);const end=Buffer.alloc(4);end.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([size,body,end]);
}
export function png(width,height,channels,depth,pixel) {
  const bytes=depth/8;const stride=width*channels*bytes+1;const raw=Buffer.alloc(stride*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const values=pixel(x,y);for(let c=0;c<channels;c++) {
      const offset=y*stride+1+(x*channels+c)*bytes;
      if(depth===16)raw.writeUInt16BE(values[c],offset);else raw[offset]=values[c];
    }
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=depth;header[9]=channels===1?0:2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export function blot(depth=8) {
  const scale=depth===16?257:1;
  return png(160,100,1,depth,(x,y)=>[(220-(y>=40&&y<50?(x>=20&&x<50?80:x>=100&&x<130?40:0):0))*scale]);
}
export function histology() {
 return png(128,96,3,8,(x,y)=>{
  for(let row=0;row<2;row++)for(let col=0;col<4;col++) {
    if((x-(20+col*28))**2+(y-(28+row*40))**2<=49)return (col+row)%2?[85,75,140]:[130,85,45];
  }
  return [245,245,245];
 });
}
export function fluorescence() {
 return png(64,32,3,8,(x,y)=>{const intensity=x<32?0:64+(x-32)*6;return [intensity,intensity,0];});
}
export const plateRows = [
 ...Array.from({length:3},()=>['C','GAPDH',20]),...Array.from({length:3},()=>['C','T',24]),
 ...Array.from({length:3},()=>['S','GAPDH',20]),['S','T',22],['S','T',22],['S','T',40],['NTC','T',10],
];
export const plateMatrix = [['Well','Sample','Target','Cq'],...plateRows.map((r,i)=>[`A${i+1}`,...r])];
export const plateCsv=plateMatrix.map(row=>row.join(',')).join('\n')+'\n';
export const rdmlXml=`<?xml version="1.0"?><rdml version="1.2">
 <sample id="C"><type>unkn</type></sample><sample id="S"><type>unkn</type></sample><sample id="NTC"><type>ntc</type></sample>
 <target id="GAPDH"><amplificationEfficiency>100</amplificationEfficiency></target><target id="T"><amplificationEfficiency>93</amplificationEfficiency></target>
 <experiment id="synthetic"><run id="plate">${plateRows.map(([sample,target,cq],i)=>`<react id="A${i+1}"><sample id="${sample}"/><data><tar id="${target}"/><cq>${cq}</cq></data></react>`).join('')}</run></experiment></rdml>`;
