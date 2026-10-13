import spec from './reading-spec.js';
import cardMap from './card-signal-map.js';

export const ENGINE_VERSION='public-final-1.0';
export const VALID_DOMAINS=Object.freeze(['love','career','finance','health']);
export const DOMAIN_NAMES=Object.freeze({love:'ความรัก',career:'การงาน',finance:'การเงิน',health:'สุขภาพ'});
export const topicIndex=new Map(spec.topics.map(t=>[`${t.domain}|${t.id}`,t]));
export const cardIndex=new Map(cardMap.profiles.map(p=>[`${p.card_id}|${p.orientation}`,p]));

const mean=xs=>xs.reduce((a,b)=>a+b,0)/(xs.length||1);
const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
function pstdev(xs){const m=mean(xs);return Math.sqrt(mean(xs.map(x=>(x-m)**2)));}
function median3(xs){const a=[...xs].sort((x,y)=>x-y);return a[1];}
function isMajor(profile){return String(profile?.card_id||'').startsWith('major-');}

function buildTopicModel(topic){
  const signalKeys=[...new Set([...topic.dimensions,...topic.archetypes.flatMap(a=>Object.keys(a.profile||{}))])];
  const rawWeights={};
  const stats={};
  for(const key of signalKeys){
    const vals=topic.archetypes.map(a=>a.profile?.[key]??50);
    const sd=pstdev(vals);
    const explicit=topic.archetypes.filter(a=>Object.hasOwn(a.profile||{},key)).length;
    const primary=topic.dimensions.includes(key);
    const discriminative=Math.min(1,sd/18);
    const explicitRatio=explicit/topic.archetypes.length;
    // Signals that do not separate any archetype should not affect the winner.
    // Extra profile signals now receive real weight instead of the old 5% tie-breaker.
    let weight=sd<2 ? 0.10 : (primary?1:0.72)*(0.55+0.90*discriminative+0.20*explicitRatio);
    rawWeights[key]=weight;
    stats[key]={sd,explicit,primary,discriminative};
  }
  const active=Object.values(rawWeights).filter(w=>w>0.15);
  const scale=active.length?mean(active):1;
  const weights=Object.fromEntries(Object.entries(rawWeights).map(([k,w])=>[k,Number((w/scale).toFixed(6))]));
  return {signalKeys,weights,stats};
}
const topicModels=new Map(spec.topics.map(t=>[`${t.domain}|${t.id}`,buildTopicModel(t)]));

export function normalizeDomain(value){
  const domain=String(value||'').trim();
  if(!VALID_DOMAINS.includes(domain)) throw new Error('หมวดคำทำนายไม่ถูกต้อง');
  return domain;
}
export function normalizeTopic(domain,value){
  const id=String(value||'').trim();
  const topic=topicIndex.get(`${domain}|${id}`);
  if(!topic) throw new Error('เรื่องที่เลือกไม่ถูกต้อง');
  return topic;
}
export function resolveCards(rawCards){
  if(!Array.isArray(rawCards)||rawCards.length!==3) throw new Error('กรุณาเลือกไพ่ให้ครบ 3 ใบ');
  const seen=new Set();
  return rawCards.map((c)=>{
    const id=String(c?.id||c?.card_id||'').trim();
    const orientation=String(c?.orientation||'').trim();
    if(!id||!['upright','reversed'].includes(orientation)) throw new Error('ข้อมูลไพ่ไม่ถูกต้อง');
    if(seen.has(id)) throw new Error('ไพ่ต้องไม่ซ้ำกัน');
    seen.add(id);
    const p=cardIndex.get(`${id}|${orientation}`);
    if(!p) throw new Error(`ไม่พบข้อมูลไพ่ ${id}`);
    return p;
  });
}

function combineOneSignal(cards,key){
  const values=cards.map(p=>Number(p.signals[key]??50));
  const cardWeights=cards.map(p=>isMajor(p)?1.08:1);
  const weightedMean=values.reduce((n,v,i)=>n+v*cardWeights[i],0)/cardWeights.reduce((a,b)=>a+b,0);
  const devs=values.map(v=>v-50);
  const meanDev=weightedMean-50;
  const medDev=median3(devs);
  const threshold=8;
  const pos=devs.filter(d=>d>threshold);
  const neg=devs.filter(d=>d<-threshold);
  const pairDirection=pos.length>=2?1:neg.length>=2?-1:0;
  const pairDevs=pairDirection>0?pos:pairDirection<0?neg:[];
  const pairMean=pairDevs.length?mean(pairDevs):0;
  const dominantIndex=devs.reduce((best,d,i)=>Math.abs(d)*(isMajor(cards[i])?1.08:1)>Math.abs(devs[best])*(isMajor(cards[best])?1.08:1)?i:best,0);
  const dominantDev=devs[dominantIndex];
  const contradictory=pos.length>0&&neg.length>0;
  let effectiveDev;
  if(pairDirection){
    // Two cards pointing the same way should survive the averaging effect.
    effectiveDev=0.42*meanDev+0.38*medDev+0.20*pairMean;
  }else if(contradictory){
    // Do not let one dramatic outlier decide a genuinely mixed spread.
    effectiveDev=0.68*meanDev+0.32*medDev;
  }else{
    effectiveDev=0.62*meanDev+0.23*medDev+0.15*dominantDev;
  }
  const positiveStrength=pos.length?mean(pos.map(Math.abs)):0;
  const negativeStrength=neg.length?mean(neg.map(Math.abs)):0;
  const contradiction=contradictory?Math.min(1,Math.min(positiveStrength,negativeStrength)/35):0;
  const spread=pstdev(values);
  return {
    values,
    mean:Number(weightedMean.toFixed(4)),
    median:Number((50+medDev).toFixed(4)),
    effective:Number(clamp(50+effectiveDev).toFixed(4)),
    spread:Number(spread.toFixed(4)),
    pair_direction:pairDirection>0?'high':pairDirection<0?'low':'mixed',
    pair_strength:Number(Math.abs(pairMean).toFixed(4)),
    contradiction:Number(contradiction.toFixed(4)),
    dominant_card_id:cards[dominantIndex].card_id,
    dominant_orientation:cards[dominantIndex].orientation,
    dominant_value:values[dominantIndex]
  };
}

export function aggregateSignalEvidence(cards,topic){
  const model=topic?topicModels.get(`${topic.domain}|${topic.id}`):null;
  const keys=model?.signalKeys||cardMap.signal_order;
  const meta={};
  const effective={};
  const raw_mean={};
  for(const key of keys){
    const m=combineOneSignal(cards,key);
    meta[key]=m;
    effective[key]=m.effective;
    raw_mean[key]=m.mean;
  }
  const cardRelevance=cards.map(p=>{
    let num=0,den=0;
    for(const key of keys){
      const w=model?.weights?.[key]??1;
      num+=w*Math.abs((p.signals[key]??50)-50);den+=w;
    }
    const score=(den?num/den:0)*(isMajor(p)?1.06:1);
    return {card_id:p.card_id,name_en:p.name_en,name_th:p.name_th,orientation:p.orientation,relevance:Number(score.toFixed(3)),major:isMajor(p)};
  }).sort((a,b)=>b.relevance-a.relevance);
  return {effective,raw_mean,meta,dominant_cards:cardRelevance};
}

// Backward-compatible helper used by audits/tests. Runtime uses aggregateSignalEvidence.
export function aggregateSignals(cards){
  return aggregateSignalEvidence(cards,null).effective;
}

function weightedDistance(model,actual,targetProfile){
  let num=0,den=0;
  const dimensions={};
  for(const key of model.signalKeys){
    const w=model.weights[key]??1;
    if(w<=0)continue;
    const a=actual[key]??50;
    const t=targetProfile?.[key]??50;
    const delta=Math.abs(a-t);
    num+=w*delta;den+=w;
    dimensions[key]={actual:a,target:t,delta,weight:w};
  }
  return {distance:den?num/den:0,dimensions};
}
function weightedCosine(model,actual,targetProfile){
  let dot=0,an=0,tn=0;
  for(const key of model.signalKeys){
    const w=model.weights[key]??1;
    if(w<=0)continue;
    const a=(actual[key]??50)-50;
    const t=(targetProfile?.[key]??50)-50;
    dot+=w*a*t;an+=w*a*a;tn+=w*t*t;
  }
  return an&&tn?dot/Math.sqrt(an*tn):0;
}
function contradictionPenalty(model,evidence,targetProfile){
  if(!evidence?.meta)return 0;
  let num=0,den=0;
  for(const key of model.signalKeys){
    const w=model.weights[key]??1;
    const target=(targetProfile?.[key]??50)-50;
    const strength=Math.min(1,Math.abs(target)/30);
    const meta=evidence.meta[key];
    if(!meta||strength===0)continue;
    let p=meta.contradiction*strength*6;
    const pairDir=meta.pair_direction==='high'?1:meta.pair_direction==='low'?-1:0;
    if(pairDir&&Math.sign(target)&&pairDir!==Math.sign(target))p+=2.5*strength;
    num+=w*p;den+=w;
  }
  return den?num/den:0;
}
function specificityOf(model,profile){
  let num=0,den=0;
  for(const key of model.signalKeys){const w=model.weights[key]??1;num+=w*Math.abs((profile?.[key]??50)-50);den+=w;}
  return den?num/den:0;
}

export function rankArchetypes(topic,input,cards=[]){
  const model=topicModels.get(`${topic.domain}|${topic.id}`);
  const evidence=input?.effective&&input?.meta?input:null;
  const actual=evidence?evidence.effective:input;
  const specificityValues=topic.archetypes.map(a=>specificityOf(model,a.profile));
  const maxSpecificity=Math.max(...specificityValues,0);
  return topic.archetypes.map((a,index)=>{
    const agg=weightedDistance(model,actual,a.profile);
    const cosine=weightedCosine(model,actual,a.profile);
    const directionPenalty=2.8*(1-cosine); // 0..5.6, intentionally secondary to semantic distance.
    let pairCardDistance=agg.distance;
    let perCard=[];
    if(cards?.length){
      perCard=cards.map(p=>{
        const d=weightedDistance(model,p.signals,a.profile).distance;
        return {card_id:p.card_id,orientation:p.orientation,distance:d};
      }).sort((x,y)=>x.distance-y.distance);
      pairCardDistance=mean(perCard.slice(0,2).map(x=>x.distance));
    }
    const contradiction=contradictionPenalty(model,evidence,a.profile);
    const specificity=specificityValues[index];
    // A spread made of three cards naturally compresses toward the middle. Without
    // this calibrated neutral penalty, low-specificity prototypes win simply because
    // they sit near 50 rather than because the cards actually support them.
    const neutralPenalty=0.48*(maxSpecificity-specificity);
    // Aggregate meaning remains primary, but two-card agreement now matters enough
    // to distinguish a coherent pair from the same arithmetic average made by
    // three conflicting cards.
    const score=cards?.length
      ? 0.72*agg.distance+0.20*pairCardDistance+0.08*directionPenalty+contradiction+neutralPenalty
      : agg.distance+0.18*directionPenalty+neutralPenalty;
    return {
      archetype:a,
      distance:score,
      aggregate_distance:agg.distance,
      pair_card_distance:pairCardDistance,
      direction_similarity:cosine,
      direction_penalty:directionPenalty,
      contradiction_penalty:contradiction,
      neutral_penalty:neutralPenalty,
      specificity,
      index,
      dimensions:agg.dimensions,
      per_card_support:perCard
    };
  }).sort((a,b)=>a.distance-b.distance||b.specificity-a.specificity||a.index-b.index);
}

export function validateApprovedCopy(topic,a){
  const issues=[];
  const full=[a.status,a.explanation,a.advice].join(' ');
  if(!a.status.includes(topic.anchor))issues.push(`status ต้องระบุ “${topic.anchor}”`);
  for(const bad of spec.global_forbidden_terms||[])if(full.includes(bad))issues.push(`พบคำต้องห้าม “${bad}”`);
  for(const bad of topic.forbidden_terms||[])if(full.includes(bad))issues.push(`พบคำต้องห้ามเฉพาะ “${bad}”`);
  if(topic.id==='overall'&&/(เป็นโรค|ไม่มีโรค|ไม่เป็นโรค|วินิจฉัย|กินยา|หยุดยา|ยานี้)/.test(full))issues.push('ข้อความสุขภาพเกินขอบเขต');
  if(topic.id==='investment'&&/(ควรซื้อ|ควรขาย|ซื้อเลย|ขายเลย|กำไรแน่นอน|ขาดทุนแน่นอน)/.test(full))issues.push('ข้อความลงทุนเกินขอบเขต');
  if(topic.id==='windfall'&&/(ถูกหวยแน่นอน|จะถูกรางวัล|ได้เงินแน่นอน|ลาภลอยแน่นอน)/.test(full))issues.push('ข้อความลาภลอยฟันธงเกินไป');
  return issues;
}
function confidenceFromMargin(gap,winnerDistance){
  const ratio=gap/Math.max(5,winnerDistance);
  if(gap>=3.2&&ratio>=0.18)return 'high';
  if(gap>=1.25&&ratio>=0.07)return 'medium';
  return 'low';
}
function readingFromWinner({domain,topic,winner,second,evidence}){
  const issues=validateApprovedCopy(topic,winner.archetype);
  if(issues.length)throw new Error(`Approved copy ไม่ผ่าน validation: ${issues.join('; ')}`);
  const gap=second?second.distance-winner.distance:100;
  const margin=gap/Math.max(5,winner.distance);
  const a=winner.archetype;
  return {
    current_status:a.status,
    explanation:a.explanation,
    next_direction:a.advice,
    answer:[a.status,a.explanation,a.advice].join('\n\n'),
    domain,
    topic_id:topic.id,
    topic_name:topic.name,
    archetype_id:a.id,
    archetype_label:a.label,
    confidence:confidenceFromMargin(gap,winner.distance),
    confidence_gap:Number(gap.toFixed(3)),
    confidence_margin:Number(margin.toFixed(4)),
    mixed_signals:evidence?.meta?Object.entries(evidence.meta).filter(([,m])=>m.contradiction>=0.45).map(([k])=>k):[],
    engine:ENGINE_VERSION,
    ai_used:false
  };
}
export function generateReading({domain:rawDomain,topic:rawTopic,cards:rawCards}){
  const domain=normalizeDomain(rawDomain);
  const topic=normalizeTopic(domain,rawTopic);
  const cards=resolveCards(rawCards);
  const evidence=aggregateSignalEvidence(cards,topic);
  const ranked=rankArchetypes(topic,evidence,cards);
  return readingFromWinner({domain,topic,winner:ranked[0],second:ranked[1],evidence});
}
export function analyzeReading({domain:rawDomain,topic:rawTopic,cards:rawCards,top=5}){
  const domain=normalizeDomain(rawDomain);
  const topic=normalizeTopic(domain,rawTopic);
  const cards=resolveCards(rawCards);
  const evidence=aggregateSignalEvidence(cards,topic);
  const ranked=rankArchetypes(topic,evidence,cards);
  const reading=readingFromWinner({domain,topic,winner:ranked[0],second:ranked[1],evidence});
  const limit=Math.max(1,Math.min(8,Number(top)||5));
  const model=topicModels.get(`${topic.domain}|${topic.id}`);
  return {
    ...reading,
    debug:{
      topic:{domain:topic.domain,id:topic.id,name:topic.name,anchor:topic.anchor,scope:topic.scope,dimensions:topic.dimensions,signal_keys:model.signalKeys,signal_weights:model.weights},
      cards:cards.map(p=>({card_id:p.card_id,name_en:p.name_en,name_th:p.name_th,orientation:p.orientation,signals:Object.fromEntries(model.signalKeys.map(d=>[d,p.signals[d]??50]))})),
      dominant_cards:evidence.dominant_cards,
      aggregate_signals:Object.fromEntries(model.signalKeys.map(d=>[d,Number((evidence.effective[d]??50).toFixed(2))])),
      raw_mean_signals:Object.fromEntries(model.signalKeys.map(d=>[d,Number((evidence.raw_mean[d]??50).toFixed(2))])),
      combination:Object.fromEntries(model.signalKeys.map(d=>[d,evidence.meta[d]])),
      ranking:ranked.slice(0,limit).map((r,idx)=>({
        rank:idx+1,
        id:r.archetype.id,
        label:r.archetype.label,
        distance:Number(r.distance.toFixed(3)),
        aggregate_distance:Number(r.aggregate_distance.toFixed(3)),
        pair_card_distance:Number(r.pair_card_distance.toFixed(3)),
        direction_similarity:Number(r.direction_similarity.toFixed(3)),
        direction_penalty:Number(r.direction_penalty.toFixed(3)),
        contradiction_penalty:Number(r.contradiction_penalty.toFixed(3)),
        neutral_penalty:Number(r.neutral_penalty.toFixed(3)),
        specificity:Number(r.specificity.toFixed(3)),
        per_card_support:r.per_card_support.map(x=>({...x,distance:Number(x.distance.toFixed(3))})),
        profile:Object.fromEntries(model.signalKeys.map(d=>[d,r.archetype.profile[d]??50])),
        deltas:Object.fromEntries(model.signalKeys.map(d=>[d,Number(r.dimensions[d].delta.toFixed(2))])),
        status:r.archetype.status,
        explanation:r.archetype.explanation,
        advice:r.archetype.advice
      }))
    }
  };
}
export function canonicalReadingKey({domain:rawDomain,topic:rawTopic,cards:rawCards}){
  const domain=normalizeDomain(rawDomain);
  const topic=normalizeTopic(domain,rawTopic);
  const cards=resolveCards(rawCards);
  const cardKey=cards.map(p=>`${p.card_id}:${p.orientation}`).sort().join('|');
  return `${domain}|${topic.id}|${cardKey}`;
}
export function getLabConfig(){
  const seen=new Map();
  for(const p of cardMap.profiles){if(!seen.has(p.card_id))seen.set(p.card_id,{id:p.card_id,name_en:p.name_en,name_th:p.name_th});}
  return {
    engine:ENGINE_VERSION,
    domains:VALID_DOMAINS.map(id=>({id,name:DOMAIN_NAMES[id]})),
    topics:spec.topics.map(t=>({domain:t.domain,id:t.id,name:t.name,anchor:t.anchor,scope:t.scope,dimensions:t.dimensions,signal_keys:topicModels.get(`${t.domain}|${t.id}`).signalKeys,signal_weights:topicModels.get(`${t.domain}|${t.id}`).weights,archetypes:t.archetypes.map(a=>({id:a.id,label:a.label}))})),
    cards:[...seen.values()].sort((a,b)=>a.name_en.localeCompare(b.name_en)),
    signal_order:cardMap.signal_order
  };
}
export function getTopicModel(domain,topic){return topicModels.get(`${domain}|${topic}`);}
export function getSpec(){return spec;}
export function getCardMap(){return cardMap;}
