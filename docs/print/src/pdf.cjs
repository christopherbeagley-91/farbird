const { chromium } = require('playwright');
(async()=>{
const b = await chromium.launch(); const p = await b.newPage();
const url='file://'+process.cwd()+'/cards.html';
await p.goto(url); await p.evaluate(()=>document.fonts.ready);
await p.pdf({ path:'Farbird-cards-Aroha-Nico-11x17.pdf', width:'17in', height:'11in', printBackground:true });
for (const [i,n] of ['Aroha','Nico'].entries()){
  await p.goto(url); await p.evaluate(()=>document.fonts.ready);
  await p.evaluate(i=>{const c=[...document.querySelectorAll('.card')][i].cloneNode(true);c.style.outline='none';document.body.innerHTML='';document.body.appendChild(c);}, i);
  await p.pdf({ path:`Farbird-card-${n}-5x7.pdf`, width:'5in', height:'7in', printBackground:true });
}
await b.close();
})();
