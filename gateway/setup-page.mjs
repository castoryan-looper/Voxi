import {readFileSync} from 'node:fs';
export function renderSetupPage(){
 const html=readFileSync(new URL('./setup.html',import.meta.url),'utf8');
 const trust=JSON.parse(readFileSync(new URL('./voxi-cloud-trust.json',import.meta.url),'utf8'));
 return html.replace('__VOXI_CLOUD_TRUST__',JSON.stringify(trust).replaceAll('<','\\u003c'));
}
