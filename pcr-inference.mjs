// Student t tails and 95% intervals. Verified against R 4.5.3 stats::qt/t.test.
// The incomplete-beta identity is documented by R's stats::TDist manual.
const coefficients = [676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
function logGamma(z) {
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI*z)) - logGamma(1-z);
  z -= 1;
  let x=0.99999999999980993;
  coefficients.forEach((c,i)=>{x+=c/(z+i+1);});
  const t=z+7.5;
  return 0.5*Math.log(2*Math.PI)+(z+0.5)*Math.log(t)-t+Math.log(x);
}
function betaFraction(a,b,x) {
  const tiny=1e-300;
  const nonzero=v=>Math.abs(v)<tiny?(v<0?-tiny:tiny):v;
  let c=1,d=1/nonzero(1-(a+b)*x/(a+1)),h=d;
  for(let m=1;m<=300;m++) {
    let aa=m*(b-m)*x/((a+2*m-1)*(a+2*m));
    d=1/nonzero(1+aa*d);c=nonzero(1+aa/c);h*=d*c;
    aa=-(a+m)*(a+b+m)*x/((a+2*m)*(a+2*m+1));
    d=1/nonzero(1+aa*d);c=nonzero(1+aa/c);
    const change=d*c;h*=change;
    if(Math.abs(change-1)<3e-14)return h;
  }
  return NaN; // Do not present a non-converged interval as a result.
}
function betaRegularized(a,b,x) {
  if(x<=0)return 0;
  if(x>=1)return 1;
  const scale=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log1p(-x));
  return x<(a+1)/(a+b+2)?scale*betaFraction(a,b,x)/a:1-scale*betaFraction(b,a,1-x)/b;
}
export function studentTTwoSidedP(t,df) {
  if(!Number.isFinite(df)||df<=0||Number.isNaN(t))return NaN;
  // Evaluate the tail directly; 1-CDF loses representable small p-values.
  return Math.min(1,Math.max(0,betaRegularized(df/2,0.5,df/(df+t*t))));
}
export function studentTCritical95(df) {
  if(!Number.isFinite(df)||df<1)return NaN;
  let low=0,high=1;
  while(studentTTwoSidedP(high,df)>0.05)high*=2;
  for(let i=0;i<70;i++) {
    const mid=(low+high)/2,p=studentTTwoSidedP(mid,df);
    if(!Number.isFinite(p))return NaN;
    if(p>0.05)low=mid;else high=mid;
  }
  return (low+high)/2;
}
export function expressionInterval95(estimate,se,df) {
  const margin=studentTCritical95(df)*se;
  if(![estimate,se,margin].every(Number.isFinite)||se<=0)return {log2FoldChangeCI95:null,foldChangeCI95:null};
  const interval=[estimate-margin,estimate+margin];
  const foldInterval=interval.map(x=>2**x);
  return {log2FoldChangeCI95:interval,foldChangeCI95:foldInterval.every(Number.isFinite)?foldInterval:null};
}
