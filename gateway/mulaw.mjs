// G.711 companding at the existing 24kHz sample clock; not 8kHz telephony.
export function encodeMulaw(pcm){
 if(pcm.length%2)throw Error('Incomplete PCM16 sample');
 const result=Buffer.alloc(pcm.length/2);
 for(let i=0;i<result.length;i++){
  let sample=pcm.readInt16LE(i*2),sign=sample<0?0x80:0;
  sample=Math.min(Math.abs(sample),32635)+132;
  let exponent=7;for(let mask=0x4000;exponent>0&&!(sample&mask);mask>>=1)exponent--;
  result[i]=~(sign|(exponent<<4)|((sample>>(exponent+3))&15))&255;
 }
 return result;
}
