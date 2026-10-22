(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fmt = (n, max=2, min=0) => Number.isFinite(n) ? n.toLocaleString('en-US',{maximumFractionDigits:max,minimumFractionDigits:min}) : '—';
  const compact = (n) => !Number.isFinite(n) ? '—' : n.toLocaleString('en-US',{maximumFractionDigits:n<1?6:4});
  const roundTo = (n, step, mode='nearest') => {
    if (!Number.isFinite(n) || !step || step <= 0) return n;
    const scaled = n / step;
    const units = mode === 'down' ? Math.floor(scaled + 1e-10) : mode === 'up' ? Math.ceil(scaled - 1e-10) : Math.round(scaled);
    return units * step;
  };
  const state = {side:'long',symbol:'BTCUSDT',contractPrice:null,markPrice:null,atr:null,atrPct:null,klines:[],stepSize:0.001,tickSize:0.1,minQty:0.001,minNotional:5,baseAsset:'BTC',priceLoaded:false,exchangeLoaded:false,filtersVerified:false,filterSource:'fallback',lastFetch:null,timer:null,klineTimer:null,fetching:false,marketRequestId:0,klineRequestId:0,activeProvider:null,activeRoot:null,connectionMode:'mainland',forceAicoin:false,aicoinRoot:'https://open.aicoin.com',futuresRoot:null,spotRoot:null,bybitRoot:null,okxRoot:null,gateRoot:null,coinbaseRoot:null,krakenRoot:null,marketErrors:[],atrSource:null};
  // Warm-start cache: show the last quote/candles immediately, then refresh from live public feeds.
  const FAST_CACHE_KEY='sympact-fast-cache-v1';
  function readFastCache(){try{return JSON.parse(localStorage.getItem(FAST_CACHE_KEY)||'null');}catch(_){return null;}}
  function writeFastCache(){try{localStorage.setItem(FAST_CACHE_KEY,JSON.stringify({symbol:state.symbol,contractPrice:state.contractPrice,markPrice:state.markPrice,provider:state.activeProvider,root:state.activeRoot,futuresRoot:state.futuresRoot,spotRoot:state.spotRoot,okxRoot:state.okxRoot,gateRoot:state.gateRoot,coinbaseRoot:state.coinbaseRoot,krakenRoot:state.krakenRoot,klines:state.klines,lastFetch:state.lastFetch?state.lastFetch.getTime():Date.now()}));}catch(_){}}
  const previousFastCache=readFastCache();
  if(previousFastCache){for(const key of ['futuresRoot','spotRoot','okxRoot','gateRoot','coinbaseRoot','krakenRoot'])if(previousFastCache[key])state[key]=previousFastCache[key];}
  const coinSymbols = {BTCUSDT:'₿',ETHUSDT:'◆',SOLUSDT:'◎',BNBUSDT:'◆',XRPUSDT:'✦',DOGEUSDT:'Ð'};
  // Mainland-first source order tries OKX and Gate public linear swaps before Binance. Bybit documents a 403 restriction for mainland-China IPs, so it is not in the automatic connection path.
  // Price is decoupled from candles: a K-line failure must not erase a working live ticker. Public relays are a last resort.
  const FUTURES_ROOTS=['https://fapi.binance.com','https://fapi1.binance.com','https://fapi2.binance.com','https://fapi3.binance.com','https://fapi4.binance.com'];
  const SPOT_ROOTS=['https://api.binance.com','https://data-api.binance.vision','https://api-gcp.binance.com','https://api1.binance.com','https://api2.binance.com','https://api3.binance.com','https://api4.binance.com'];
  const BYBIT_ROOTS=['https://api.bybit.com','https://api.bytick.com'];
  const OKX_ROOTS=['https://www.okx.com','https://aws.okx.com'];
  const GATE_ROOTS=['https://api.gateio.ws','https://fx-api.gateio.ws'];
  const COINBASE_ROOTS=['https://api.exchange.coinbase.com'];
  const KRAKEN_ROOTS=['https://api.kraken.com'];
  const PUBLIC_RELAYS=[
    {id:'allorigins',wrap:u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u)},
    {id:'corsproxy',wrap:u=>'https://corsproxy.io/?url='+encodeURIComponent(u)}
  ];
  const rootURL=(root,path)=>{
    if(root.startsWith('proxy:')){const parts=root.split(':');const relay=PUBLIC_RELAYS.find(p=>p.id===parts[1]);const upstream=parts.slice(2).join(':')+path;return relay?relay.wrap(upstream):upstream;}
    return root+path;
  };
  function livePrice(){const manual=Number($('manualPrice')?.value);if(Number.isFinite(manual)&&manual>0)return manual;if($('workingType').value==='MARK_PRICE')return state.markPrice||state.contractPrice;return state.contractPrice||state.markPrice;}
  function effectiveAtrPct(){const manual=Number($('manualAtrPct')?.value);return Number.isFinite(manual)&&manual>0?manual:state.atrPct;}
  function effectiveAtr(){const p=effectiveAtrPct();return Number.isFinite(p)&&p>0?(Number($('manualAtrPct').value)>0&&livePrice()?p/100*livePrice():state.atr):null;}
  function setStatus(type,text){$('statusDot').className='dot'+(type==='ok'?' ok':type==='bad'?' bad':type==='warn'?' warn':'');$('statusText').textContent=text;}
  function showToast(text){const t=$('toast');t.textContent=text;t.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.remove('show'),1800);}
  async function getJSON(url,timeout=6000,parentSignal=null){
    const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),timeout);
    const abortFromParent=()=>ctrl.abort();
    if(parentSignal){if(parentSignal.aborted)ctrl.abort();else parentSignal.addEventListener('abort',abortFromParent,{once:true});}
    try{const res=await fetch(url,{signal:ctrl.signal,cache:'no-store',mode:'cors'});if(!res.ok)throw new Error('HTTP '+res.status);const data=await res.json();return data;}
    finally{clearTimeout(timer);if(parentSignal)parentSignal.removeEventListener('abort',abortFromParent);}
  }
  function currentInterval(){return $('intervalSelect').value;}
  function bybitInterval(){return ({'15m':'15','1h':'60','4h':'240','1d':'D'})[currentInterval()]||'60';}
  function validBinanceTicker(d){return Number(d&&d.price)>0;}
  function validSpotTicker(d){return Number(d&&d.price)>0;}
  function validBybitTicker(d){return !!(d&&Number(d.retCode)===0&&d.result&&Array.isArray(d.result.list)&&d.result.list.length&&Number(d.result.list[0].lastPrice)>0);}
  async function firstWorkingRoot(roots,path,validator,cachedRoot){
    if(cachedRoot){
      try{const data=await getJSON(rootURL(cachedRoot,path),3200);if(validator(data))return {root:cachedRoot,data};}
      catch(e){console.warn('Cached market endpoint failed',cachedRoot,e);}
    }
    async function race(candidates){
      const controller=new AbortController();const failures=[];
      const attempts=candidates.map(root=>getJSON(rootURL(root,path),5000,controller.signal).then(data=>{
        if(!validator(data))throw new Error('HTTP 成功但返回数据格式不符合预期');return {root,data};
      }).catch(error=>{failures.push((root.startsWith('proxy:')?root.split(':').slice(0,2).join(':'):root)+' → '+(error&&error.message||String(error)));throw error;}));
      try{const winner=await Promise.any(attempts);controller.abort();return winner;}
      catch(e){controller.abort();throw new Error(failures.slice(0,7).join('；')||'所有请求都失败');}
    }
    try{return await race(roots.filter(r=>r!==cachedRoot));}
    catch(directError){
      // Public CORS relays are an optional last resort for static file:// pages.
      const relayRoots=PUBLIC_RELAYS.map(relay=>'proxy:'+relay.id+':'+roots[0]);
      try{return await race(relayRoots);}
      catch(relayError){throw new Error('直连失败 ['+directError.message+']；中转失败 ['+relayError.message+']');}
    }
  }
  function aicoinConfigured(){return !!($('aicoinAccessKey')?.value.trim()&&$('aicoinSecret')?.value);}
  function providerOrder(){
    const mainland=['okx-swap','aicoin-aggregated','gate-futures','binance-futures','binance-spot','coinbase-spot','kraken-spot'];
    const binance=['binance-futures','binance-spot','okx-swap','aicoin-aggregated','gate-futures','coinbase-spot','kraken-spot'];
    const all0=state.connectionMode==='binance'?binance:mainland;
    const all=aicoinConfigured()?all0:all0.filter(id=>id!=='aicoin-aggregated');
    if(state.forceAicoin&&aicoinConfigured())return ['aicoin-aggregated',...all.filter(id=>id!=='aicoin-aggregated')];
    if(state.activeProvider&&all.includes(state.activeProvider))return [state.activeProvider,...all.filter(x=>x!==state.activeProvider)];
    return all;
  }
  function validateKlines(data){return Array.isArray(data)&&data.length>=16;}
  function okxInstrument(symbol){return symbol.replace(/USDT$/,'-USDT-SWAP');}
  function coinbaseProduct(symbol){const base=symbol.replace(/USDT$/,'');return ({BTC:'BTC-USD',ETH:'ETH-USD',SOL:'SOL-USD',BNB:'BNB-USD',XRP:'XRP-USD',DOGE:'DOGE-USD'})[base]||base+'-USD';}
  function normalizeOkxKlines(rows){return rows.slice().reverse().map(k=>[Number(k[0]),k[1],k[2],k[3],k[4],k[5]||'0']);}
  function normalizeCoinbaseKlines(rows,interval){
    // Coinbase candles are [unix seconds, low, high, open, close, volume], newest first.
    let bars=rows.map(k=>[Number(k[0])*1000,String(k[3]),String(k[2]),String(k[1]),String(k[4]),String(k[5]||0)]).sort((a,b)=>a[0]-b[0]);
    if(interval==='4h'){
      const grouped=new Map();
      for(const b of bars){const bucket=Math.floor(b[0]/14400000)*14400000;const prev=grouped.get(bucket);if(!prev)grouped.set(bucket,[bucket,b[1],b[2],b[3],b[4],Number(b[5])]);else{prev[2]=String(Math.max(Number(prev[2]),Number(b[2])));prev[3]=String(Math.min(Number(prev[3]),Number(b[3])));prev[4]=b[4];prev[5]+=Number(b[5]);}}
      bars=[...grouped.values()].map(b=>[b[0],b[1],b[2],b[3],b[4],String(b[5])]);
    }
    return bars;
  }
  async function aicoinSignature(accessKey,secret,nonce,timestamp){
    if(!globalThis.crypto?.subtle)throw new Error('当前浏览器不支持 WebCrypto 签名，请更新浏览器后重试');
    const text=`AccessKeyId=${accessKey}&SignatureNonce=${nonce}&Timestamp=${timestamp}`;
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
    const raw=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text)));
    const hex=Array.from(raw,b=>b.toString(16).padStart(2,'0')).join('');
    return btoa(hex);
  }
  async function aicoinRequest(path,params,timeout=7000){
    const accessKey=$('aicoinAccessKey').value.trim(),secret=$('aicoinSecret').value;
    if(!accessKey||!secret)throw new Error('尚未填写 AiCoin API 凭证');
    const timestamp=Math.floor(Date.now()/1000).toString();
    const nonce=Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>b.toString(16).padStart(2,'0')).join('');
    const signature=await aicoinSignature(accessKey,secret,nonce,timestamp);
    const query=new URLSearchParams({...params,AccessKeyId:accessKey,SignatureNonce:nonce,Timestamp:timestamp,Signature:signature});
    const data=await getJSON('https://open.aicoin.com/api/v2/'+path+'?'+query.toString(),timeout);
    if(!data||data.success!==true)throw new Error('AiCoin API 返回失败：'+(data?.error||data?.msg||data?.errorCode||'未知错误'));
    return data;
  }
  function aicoinPairCandidates(symbol){const base=symbol.replace(/USDT$/,'').toLowerCase();return [base+'swapusdt:binance',base+'usdt:binance'];}
  async function fetchAICoin(symbol,needKlines){
    const keys=aicoinPairCandidates(symbol);
    const d=await aicoinRequest('trading-pair/ticker',{key_list:keys.join(',')});
    const rows=Array.isArray(d.data)?d.data:[];
    const item=keys.map(k=>rows.find(r=>r&&r.key===k)).find(Boolean);
    if(!item)throw new Error('AiCoin 未返回此币种的 Binance 交易对；可在 AiCoin 交易对列表核对 key');
    const price=Number(item.last_raw||item.last_usd);
    if(!(price>0))throw new Error('AiCoin 返回的最新价格无效');
    let rawKlines=null,klineError=null,usedKey=item.key;
    if(needKlines){
      const periods=({'15m':'900','1h':'3600','4h':'14400','1d':'86400'});
      const period=periods[currentInterval()]||'3600';
      try{
        for(const key of [item.key,...keys.filter(k=>k!==item.key)]){
          try{
            const kd=await aicoinRequest('commonKline/dataRecords',{symbol:key,period,size:'100'},6500);
            const bars=kd.data?.kline_data;
            if(Array.isArray(bars)&&bars.length>=16){rawKlines=bars.map(k=>[Number(k[0])*1000,String(k[1]),String(k[2]),String(k[3]),String(k[4]),String(k[5]||0)]).filter(k=>Number.isFinite(k[0])&&Number(k[4])>0).sort((a,b)=>a[0]-b[0]);if(rawKlines.length>=16){usedKey=key;break;}}
          }catch(e){klineError=e;}
        }
        if(!rawKlines)throw klineError||new Error('AiCoin K 线数据不可用或当前套餐未授权此接口');
      }catch(e){klineError=e;}
    }
    return {id:'aicoin-aggregated',label:'AiCoin 聚合行情参考（非币安实时标记价）',root:'https://open.aicoin.com',contractPrice:price,markPrice:price,klines:rawKlines,klineError,kind:'aggregated-reference',pairKey:usedKey};
  }
  async function fetchBinanceFutures(symbol,needKlines){
    const path='/fapi/v1/ticker/price?symbol='+encodeURIComponent(symbol);
    const selected=await firstWorkingRoot(FUTURES_ROOTS,path,validBinanceTicker,state.futuresRoot);state.futuresRoot=selected.root;
    const premiumPath='/fapi/v1/premiumIndex?symbol='+encodeURIComponent(symbol);
    // Mark price is optional and fetched in the background; a slow mark-price endpoint must never block last price.
    getJSON(rootURL(selected.root,premiumPath),2800).then(data=>{
      if(Number(data&&data.markPrice)>0&&state.symbol===symbol&&state.activeProvider==='binance-futures'&&state.activeRoot===selected.root){state.markPrice=Number(data.markPrice);updateMarketUI();calculate();}
    }).catch(()=>{});
    return {id:'binance-futures',label:selected.root.startsWith('proxy:')?'币安合约行情（公共中转）':'币安 USDⓈ-M 合约行情',root:selected.root,contractPrice:Number(selected.data.price),markPrice:Number(selected.data.price),klines:null,kind:'futures'};
  }
  async function fetchBybit(symbol,needKlines){
    const tickerPath='/v5/market/tickers?category=linear&symbol='+encodeURIComponent(symbol);
    const selected=await firstWorkingRoot(BYBIT_ROOTS,tickerPath,validBybitTicker,state.bybitRoot);state.bybitRoot=selected.root;const item=selected.data.result.list[0];
    let rawKlines=null,klineError=null;
    if(needKlines){try{const path='/v5/market/kline?category=linear&symbol='+encodeURIComponent(symbol)+'&interval='+bybitInterval()+'&limit=100';const data=await getJSON(rootURL(selected.root,path),6500);if(Number(data.retCode)!==0||!Array.isArray(data.result?.list)||data.result.list.length<16)throw new Error('Bybit K-line response invalid');rawKlines=data.result.list.slice().reverse().map(k=>[k[0],k[1],k[2],k[3],k[4],k[5]]);}catch(e){klineError=e;}}
    return {id:'bybit-linear',label:selected.root.startsWith('proxy:')?'Bybit 合约备用行情（公共中转）':'Bybit USDT 线性合约备用行情',root:selected.root,contractPrice:Number(item.lastPrice),markPrice:Number(item.markPrice)||Number(item.lastPrice),klines:rawKlines,klineError,kind:'alternate-futures'};
  }
  async function fetchOKX(symbol,needKlines){
    const inst=okxInstrument(symbol),tickerPath='/api/v5/market/ticker?instId='+encodeURIComponent(inst);
    const valid=d=>!!(d&&String(d.code)==='0'&&Array.isArray(d.data)&&d.data.length&&Number(d.data[0].last)>0);
    const selected=await firstWorkingRoot(OKX_ROOTS,tickerPath,valid,state.okxRoot);state.okxRoot=selected.root;const item=selected.data.data[0];
    let rawKlines=null,klineError=null;
    if(needKlines){try{const bar=({'15m':'15m','1h':'1H','4h':'4H','1d':'1D'})[currentInterval()]||'1H';const path='/api/v5/market/candles?instId='+encodeURIComponent(inst)+'&bar='+encodeURIComponent(bar)+'&limit=100';const d=await getJSON(rootURL(selected.root,path),6500);if(String(d.code)!=='0'||!Array.isArray(d.data)||d.data.length<16)throw new Error('OKX K-line response invalid');rawKlines=normalizeOkxKlines(d.data);}catch(e){klineError=e;}}
    return {id:'okx-swap',label:selected.root.startsWith('proxy:')?'OKX 合约备用行情（公共中转）':'OKX USDT 永续备用行情',root:selected.root,contractPrice:Number(item.last),markPrice:Number(item.last),klines:rawKlines,klineError,kind:'alternate-futures'};
  }
  function gateContract(symbol){return symbol.replace(/USDT$/,'')+'_USDT';}
  function normalizeGateKlines(rows){
    return (rows||[]).map(k=>Array.isArray(k)?[Number(k[0])*1000,k[5],k[3],k[4],k[2],k[1]]:[Number(k.t)*1000,String(k.o),String(k.h),String(k.l),String(k.c),String(k.v)]).filter(k=>Number.isFinite(k[0])&&Number(k[4])>0).sort((a,b)=>a[0]-b[0]);
  }
  async function fetchGateFutures(symbol,needKlines){
    const contract=gateContract(symbol),tickerPath='/api/v4/futures/usdt/tickers?contract='+encodeURIComponent(contract);
    const valid=d=>Array.isArray(d)&&d.length>0&&d.some(x=>x&&x.contract===contract&&Number(x.last)>0);
    const selected=await firstWorkingRoot(GATE_ROOTS,tickerPath,valid,state.gateRoot);state.gateRoot=selected.root;
    const item=selected.data.find(x=>x.contract===contract)||selected.data[0];
    let rawKlines=null,klineError=null;
    if(needKlines){try{
      const interval=({'15m':'15m','1h':'1h','4h':'4h','1d':'1d'})[currentInterval()]||'1h';
      const path='/api/v4/futures/usdt/candlesticks?contract='+encodeURIComponent(contract)+'&interval='+encodeURIComponent(interval)+'&limit=100';
      const d=await getJSON(rootURL(selected.root,path),6500);if(!Array.isArray(d)||d.length<16)throw new Error('Gate 合约 K 线响应无效或数量不足');
      rawKlines=normalizeGateKlines(d);if(rawKlines.length<16)throw new Error('Gate 合约 K 线有效数据不足');
    }catch(e){klineError=e;}}
    return {id:'gate-futures',label:selected.root.startsWith('proxy:')?'Gate USDT 永续行情（公共中转）':'Gate USDT 永续公开行情',root:selected.root,contractPrice:Number(item.last),markPrice:Number(item.mark_price)||Number(item.last),klines:rawKlines,klineError,kind:'alternate-futures'};
  }
  async function fetchBinanceSpot(symbol,needKlines){
    const path='/api/v3/ticker/price?symbol='+encodeURIComponent(symbol);const selected=await firstWorkingRoot(SPOT_ROOTS,path,validSpotTicker,state.spotRoot);state.spotRoot=selected.root;
    let rawKlines=null,klineError=null;
    if(needKlines){try{const kp='/api/v3/klines?symbol='+encodeURIComponent(symbol)+'&interval='+encodeURIComponent(currentInterval())+'&limit=100';const data=await getJSON(rootURL(selected.root,kp),6500);if(!validateKlines(data))throw new Error('Binance spot K-line response invalid');rawKlines=data;}catch(e){klineError=e;}}
    return {id:'binance-spot',label:selected.root.startsWith('proxy:')?'币安现货备用行情（公共中转）':'币安现货备用行情',root:selected.root,contractPrice:Number(selected.data.price),markPrice:null,klines:rawKlines,klineError,kind:'spot'};
  }
  async function fetchCoinbase(symbol,needKlines){
    const product=coinbaseProduct(symbol),tickerPath='/products/'+encodeURIComponent(product)+'/ticker';
    const valid=d=>Number(d&&d.price)>0;
    const selected=await firstWorkingRoot(COINBASE_ROOTS,tickerPath,valid,state.coinbaseRoot);state.coinbaseRoot=selected.root;
    let rawKlines=null,klineError=null;
    if(needKlines){try{const granularity=({'15m':'900','1h':'3600','4h':'3600','1d':'86400'})[currentInterval()]||'3600';const kp='/products/'+encodeURIComponent(product)+'/candles?granularity='+granularity;const data=await getJSON(rootURL(selected.root,kp),6500);if(!Array.isArray(data)||data.length<16)throw new Error('Coinbase candle response invalid');rawKlines=normalizeCoinbaseKlines(data,currentInterval());if(rawKlines.length<16)rawKlines=null;if(!rawKlines)throw new Error('Coinbase has insufficient candles for selected timeframe');}catch(e){klineError=e;}}
    return {id:'coinbase-spot',label:selected.root.startsWith('proxy:')?'Coinbase 现货参考（公共中转）':'Coinbase USD 现货参考（非币安合约）',root:selected.root,contractPrice:Number(selected.data.price),markPrice:null,klines:rawKlines,klineError,kind:'spot-reference'};
  }
  function krakenPair(symbol){const base=symbol.replace(/USDT$/,'');return ({BTC:'XBTUSD',ETH:'ETHUSD',SOL:'SOLUSD',BNB:'BNBUSD',XRP:'XRPUSD',DOGE:'XDGUSD'})[base]||base+'USD';}
  function krakenResultRows(data){if(!data||!data.result)return null;const key=Object.keys(data.result).find(k=>k!=='last');return key?data.result[key]:null;}
  async function fetchKraken(symbol,needKlines){
    const pair=krakenPair(symbol),tickerPath='/0/public/Ticker?pair='+encodeURIComponent(pair);
    const valid=d=>!d?.error?.length&&!!(krakenResultRows(d)&&Number(krakenResultRows(d).c?.[0])>0);
    const selected=await firstWorkingRoot(KRAKEN_ROOTS,tickerPath,valid,state.krakenRoot);state.krakenRoot=selected.root;const ticker=krakenResultRows(selected.data);
    let rawKlines=null,klineError=null;
    if(needKlines){try{const interval=({'15m':15,'1h':60,'4h':240,'1d':1440})[currentInterval()]||60;const path='/0/public/OHLC?pair='+encodeURIComponent(pair)+'&interval='+interval;const d=await getJSON(rootURL(selected.root,path),6500);const rows=krakenResultRows(d);if(d.error?.length||!Array.isArray(rows)||rows.length<16)throw new Error('Kraken K 线响应无效或数量不足');rawKlines=rows.map(k=>[Number(k[0])*1000,k[1],k[2],k[3],k[4],k[6]||'0']);}catch(e){klineError=e;}}
    return {id:'kraken-spot',label:selected.root.startsWith('proxy:')?'Kraken 现货参考（公共中转）':'Kraken USD 现货参考（非币安合约）',root:selected.root,contractPrice:Number(ticker.c[0]),markPrice:null,klines:rawKlines,klineError,kind:'spot-reference'};
  }
  function wsOneShot(url,onOpen,extract,timeoutMs=4500){
    return new Promise((resolve,reject)=>{
      let ws=null,settled=false;
      const done=(err,value)=>{if(settled)return;settled=true;clearTimeout(timer);try{ws?.close();}catch{};if(err)reject(err);else resolve(value);};
      const timer=setTimeout(()=>done(new Error('WebSocket 等待数据超时（'+url.split('/')[2]+'）')),timeoutMs);
      try{
        ws=new WebSocket(url);
        ws.onopen=()=>{try{if(onOpen)onOpen(ws);}catch(e){done(e);}};
        ws.onmessage=event=>{try{const value=extract(JSON.parse(event.data));if(value)done(null,value);}catch(e){/* Ignore subscription acknowledgements or non-market messages. */}};
        ws.onerror=()=>done(new Error('WebSocket 连接失败（'+url.split('/')[2]+'）'));
        ws.onclose=()=>{if(!settled)done(new Error('WebSocket 已关闭（'+url.split('/')[2]+'）'));};
      }catch(e){done(e);}
    });
  }
  async function fetchWebSocketFallback(symbol){
    const low=symbol.toLowerCase(),inst=okxInstrument(symbol);
    const attempts=[
      wsOneShot('wss://fstream.binance.com/ws/'+low+'@ticker',null,d=>Number(d&&d.c)>0?({id:'binance-futures',label:'币安 USDⓈ-M 合约行情（WebSocket）',root:'wss://fstream.binance.com',contractPrice:Number(d.c),markPrice:null,klines:null,kind:'futures-ws'}):null),
      wsOneShot('wss://ws.okx.com:8443/ws/v5/public',ws=>ws.send(JSON.stringify({op:'subscribe',args:[{channel:'tickers',instId:inst}]})),d=>d&&d.arg?.channel==='tickers'&&Array.isArray(d.data)&&Number(d.data[0]?.last)>0?({id:'okx-swap',label:'OKX USDT 永续备用行情（WebSocket）',root:'wss://ws.okx.com:8443',contractPrice:Number(d.data[0].last),markPrice:Number(d.data[0].last),klines:null,kind:'alternate-futures-ws'}):null)
    ];
    try{return await Promise.any(attempts);}catch(e){const details=(e&&Array.isArray(e.errors)?e.errors:[]).map(x=>x&&x.message||String(x)).join('；');throw new Error(details||'所有 WebSocket 备用行情连接失败');}
  }
  async function fetchKlinesFrom(id,symbol){
    if(id==='aicoin-aggregated'){const r=await fetchAICoin(symbol,true);if(!validateKlines(r.klines))throw r.klineError||new Error('AiCoin K 线不足');return {klines:r.klines,source:'AiCoin 聚合行情 K 线参考'};}
    if(id==='binance-futures'){
      const path='/fapi/v1/klines?symbol='+encodeURIComponent(symbol)+'&interval='+encodeURIComponent(currentInterval())+'&limit=100';
      const x=await firstWorkingRoot(FUTURES_ROOTS,path,validateKlines,state.futuresRoot);state.futuresRoot=x.root;return {klines:x.data,source:'币安合约 K 线'};
    }
    if(id==='okx-swap'){
      const path='/api/v5/market/candles?instId='+encodeURIComponent(okxInstrument(symbol))+'&bar='+encodeURIComponent(({'15m':'15m','1h':'1H','4h':'4H','1d':'1D'})[currentInterval()]||'1H')+'&limit=100';
      const x=await firstWorkingRoot(OKX_ROOTS,path,d=>String(d&&d.code)==='0'&&Array.isArray(d.data)&&d.data.length>=16,state.okxRoot);state.okxRoot=x.root;return {klines:normalizeOkxKlines(x.data.data),source:'OKX 合约 K 线'};
    }
    if(id==='gate-futures'){
      const contract=gateContract(symbol),interval=({'15m':'15m','1h':'1h','4h':'4h','1d':'1d'})[currentInterval()]||'1h';
      const path='/api/v4/futures/usdt/candlesticks?contract='+encodeURIComponent(contract)+'&interval='+encodeURIComponent(interval)+'&limit=100';
      const x=await firstWorkingRoot(GATE_ROOTS,path,d=>Array.isArray(d)&&d.length>=16,state.gateRoot);state.gateRoot=x.root;const bars=normalizeGateKlines(x.data);if(bars.length<16)throw new Error('Gate K 线数量不足');return {klines:bars,source:'Gate USDT 永续 K 线'};
    }
    if(id==='binance-spot'){
      const path='/api/v3/klines?symbol='+encodeURIComponent(symbol)+'&interval='+encodeURIComponent(currentInterval())+'&limit=100';const x=await firstWorkingRoot(SPOT_ROOTS,path,validateKlines,state.spotRoot);state.spotRoot=x.root;return {klines:x.data,source:'币安现货 K 线'};
    }
    if(id==='coinbase-spot'){
      const granularity=({'15m':'900','1h':'3600','4h':'3600','1d':'86400'})[currentInterval()]||'3600';const path='/products/'+encodeURIComponent(coinbaseProduct(symbol))+'/candles?granularity='+granularity;const x=await firstWorkingRoot(COINBASE_ROOTS,path,d=>Array.isArray(d)&&d.length>=16,state.coinbaseRoot);state.coinbaseRoot=x.root;const bars=normalizeCoinbaseKlines(x.data,currentInterval());if(bars.length<16)throw new Error('Coinbase candles insufficient');return {klines:bars,source:'Coinbase 现货 K 线'};
    }
    if(id==='kraken-spot'){
      const pair=krakenPair(symbol),interval=({'15m':15,'1h':60,'4h':240,'1d':1440})[currentInterval()]||60;const path='/0/public/OHLC?pair='+encodeURIComponent(pair)+'&interval='+interval;
      const x=await firstWorkingRoot(KRAKEN_ROOTS,path,d=>!d?.error?.length&&Array.isArray(krakenResultRows(d))&&krakenResultRows(d).length>=16,state.krakenRoot);state.krakenRoot=x.root;return {klines:krakenResultRows(x.data).map(k=>[Number(k[0])*1000,k[1],k[2],k[3],k[4],k[6]||'0']),source:'Kraken 现货 K 线'};
    }
    throw new Error('unknown kline provider');
  }
  async function loadKlineFallback(symbol,klineToken,primaryId){
    const all=['okx-swap','aicoin-aggregated','gate-futures','binance-futures','binance-spot','coinbase-spot','kraken-spot'];const order=[primaryId,...all.filter(id=>id!==primaryId)];
    const errors=[];
    for(const id of order){try{const r=await fetchKlinesFrom(id,symbol);if(symbol!==state.symbol||klineToken!==state.klineRequestId)return false;if(validateKlines(r.klines)){state.klines=r.klines;state.atrSource=r.source;computeATR(r.klines);drawSparkline(r.klines);updateMarketUI();calculate();writeFastCache();return true;}}catch(e){errors.push(id+': '+(e&&e.message||e));}}
    if(symbol===state.symbol&&klineToken===state.klineRequestId){state.atr=null;state.atrPct=null;state.atrSource=null;$('atrUnit').textContent='自动 ATR 读取失败 · 可手动填 ATR%';$('callbackExplain').textContent='价格行情可用，但所有 K 线源均失败。请尝试手动填写 ATR%，或稍后重试。诊断：'+errors.join(' | ');calculate();}
    return false;
  }
  async function loadExchangeInfo(){
    if(state.exchangeLoaded){applyFilters();return;}
    try{
      const rootInfo=await firstWorkingRoot(FUTURES_ROOTS,'/fapi/v1/ticker/price?symbol=BTCUSDT',validBinanceTicker,state.futuresRoot);state.futuresRoot=rootInfo.root;
      const data=await getJSON(rootURL(state.futuresRoot,'/fapi/v1/exchangeInfo'),10000);
      if(!Array.isArray(data.symbols))throw new Error('exchangeInfo format invalid');
      state.exchangeInfo=data;state.exchangeLoaded=true;applyFilters();
    }catch(e){console.warn('Binance exchangeInfo unavailable',e);state.filtersVerified=false;state.filterSource='fallback';updateUnit();if(!state.priceLoaded)setStatus('warn','行情已尝试连接 · 币安交易规则暂未读取');}
  }
  function applyFilters(){
    const data=state.exchangeInfo;if(!data){state.filtersVerified=false;state.filterSource='fallback';updateUnit();return;}
    const item=(data.symbols||[]).find(s=>s.symbol===state.symbol);if(!item){state.filtersVerified=false;state.filterSource='fallback';updateUnit();return;}
    state.baseAsset=item.baseAsset||state.symbol.replace('USDT','');const filters=item.filters||[];
    const price=filters.find(f=>f.filterType==='PRICE_FILTER');const lot=filters.find(f=>f.filterType==='LOT_SIZE');const marketQty=filters.find(f=>f.filterType==='MARKET_LOT_SIZE');
    if(price)state.tickSize=Number(price.tickSize)||state.tickSize;
    const steps=[lot,marketQty].filter(Boolean).map(f=>Number(f.stepSize)||0).filter(n=>n>0);const mins=[lot,marketQty].filter(Boolean).map(f=>Number(f.minQty)||0).filter(n=>n>0);
    if(steps.length)state.stepSize=Math.max(...steps);if(mins.length)state.minQty=Math.max(...mins);
    const notionalFilter=filters.find(f=>f.filterType==='MIN_NOTIONAL'||f.filterType==='NOTIONAL');if(notionalFilter)state.minNotional=Number(notionalFilter.notional||notionalFilter.minNotional)||state.minNotional;
    state.filtersVerified=!!(price&&steps.length&&mins.length);state.filterSource=state.filtersVerified?'Binance exchangeInfo':'partial';updateUnit();calculate();
  }
  function updateUnit(){
    $('qtyUnit').textContent=state.baseAsset+' · '+(state.filtersVerified?'按币安规则取整':'理论数量；步进待核对');
    $('headerSymbol').textContent=state.symbol+' · 永续';$('coinIcon').textContent=coinSymbols[state.symbol]||'◆';
  }
  async function loadMarket({klines=true}={}){
    const symbol=state.symbol;const requestId=++state.marketRequestId;state.fetching=true;
    const loaders={'binance-futures':fetchBinanceFutures,'okx-swap':fetchOKX,'aicoin-aggregated':fetchAICoin,'gate-futures':fetchGateFutures,'binance-spot':fetchBinanceSpot,'coinbase-spot':fetchCoinbase,'kraken-spot':fetchKraken};
    const failures=[];let accepted=null;
    try{
      // Once a WebSocket source works, retry that low-latency path first on subsequent refreshes.
      if((state.activeRoot||'').startsWith('wss://')){try{accepted=await fetchWebSocketFallback(symbol);}catch(e){failures.push('WebSocket 备用：'+(e&&e.message||e));}}
      const order=providerOrder();
      if(!accepted&&order.length){
        const preferred=order[0];let delayTimer;
        const first=await Promise.race([
          loaders[preferred](symbol,false).then(result=>({kind:'success',result}),error=>({kind:'failure',error})),
          new Promise(resolve=>{delayTimer=setTimeout(()=>resolve({kind:'timeout'}),preferred==='aicoin-aggregated'?1200:600);})
        ]);
        clearTimeout(delayTimer);
        if(first.kind==='success'&&Number(first.result.contractPrice)>0)accepted=first.result;
        else{
          if(first.kind==='failure')failures.push(preferred+': '+(first.error&&first.error.message||String(first.error)));
          else failures.push(preferred+': 1.8 秒内未连接成功，转试备用行情源');
          // Run all backup providers in parallel. This avoids waiting serially for several blocked exchange hosts.
          const makeAttempt=id=>loaders[id](symbol,false).then(result=>{
            if(!(Number(result.contractPrice)>0))throw new Error('返回价格为空或不是数字');return result;
          }).catch(error=>{failures.push(id+': '+(error&&error.message||String(error)));throw error;});
          const derivativeIds=order.filter(id=>id!==preferred&&['binance-futures','okx-swap','aicoin-aggregated','gate-futures'].includes(id));
          const derivativeBackups=derivativeIds.map(makeAttempt);
          const wsBackup=fetchWebSocketFallback(symbol).catch(error=>{failures.push('WebSocket 备用：'+(error&&error.message||error));throw error;});
          try{accepted=await Promise.any([...derivativeBackups,wsBackup]);}catch(e){
            // Spot-only prices are a last-resort reference and are not treated as Binance contract/mark prices.
            const spotIds=order.filter(id=>id!==preferred&&!['binance-futures','okx-swap','aicoin-aggregated','gate-futures'].includes(id));
            try{accepted=await Promise.any(spotIds.map(makeAttempt));}catch(spotError){/* Keep all diagnostics. */}
          }
        }
      }
      if(requestId!==state.marketRequestId||symbol!==state.symbol)return;
      state.marketErrors=failures;
      if(!accepted){
        $('marketCaption').textContent='所有直连行情服务均不可用';
        $('priceTime').textContent='点击状态查看连接诊断';
        $('connectionDiagnostic').style.display='flex';$('diagnosticText').textContent=failures.join('；').slice(0,1800);
        $('priceTime').title=failures.join('\n');
        if(!state.priceLoaded)setStatus('bad','公开行情连接失败 · 查看诊断');
        else{setStatus('warn','行情刷新失败 · 保留最后有效数据');$('priceTime').textContent='最后更新 '+state.lastFetch.toLocaleTimeString('zh-CN',{hour12:false})+' · 本次失败：'+failures.join(' | ').slice(0,350);}
        return;
      }
      if(!(Number(accepted.contractPrice)>0))throw new Error('所有数据源返回的价格均无效');
      state.contractPrice=Number(accepted.contractPrice);state.markPrice=Number(accepted.markPrice)>0?Number(accepted.markPrice):null;
      state.priceLoaded=true;state.activeProvider=accepted.id;state.activeRoot=accepted.root;state.lastFetch=new Date();$('connectionDiagnostic').style.display='none';writeFastCache();
      if(klines){state.klines=[];state.atr=null;state.atrPct=null;state.atrSource=null;drawSparkline([]);}
      if($('followMarket').checked&&!Number($('entry').dataset.userEdited||0))$('entry').value=String(livePrice()||state.contractPrice);
      updateMarketUI();calculate();
      if(accepted.id==='aicoin-aggregated'){setStatus('warn','已切换 AiCoin 聚合行情参考');$('aicoinStatus').textContent='AiCoin 行情连接成功：'+(accepted.pairKey||'当前交易对')+'。该报价可能与币安合约成交价/标记价不同，激活价请在币安实际下单界面复核。';}
      else if(accepted.id==='binance-futures')setStatus('ok',accepted.root.startsWith('wss://')?'币安合约行情已连接 · WebSocket':accepted.root.startsWith('proxy:')?'币安合约行情已连接 · 公共中转':'币安合约行情已连接');
      else if(accepted.id==='bybit-linear')setStatus('warn','已切换 Bybit 合约备用行情');
      else if(accepted.id==='okx-swap')setStatus('warn','已切换 OKX 合约备用行情');
      else if(accepted.id==='gate-futures')setStatus('warn','已切换 Gate USDT 永续备用行情');
      else if(accepted.id==='binance-spot')setStatus('warn','已切换币安现货备用行情');
      else if(accepted.id==='coinbase-spot')setStatus('warn','已切换 Coinbase 现货参考价');
      else setStatus('warn','已切换 Kraken 现货参考价');
      $('priceTime').title='本次行情源：'+accepted.label+'；当前币种：'+symbol;
      if(klines){
        // Load candles only after price has rendered. A K-line failure must not make the quote disappear.
        const klineToken=++state.klineRequestId;loadKlineFallback(symbol,klineToken,accepted.id).catch(e=>console.warn('K-line fallback failed',e));
      }
    }finally{if(requestId===state.marketRequestId)state.fetching=false;}
  }
  function computeATR(raw){
    if(!Array.isArray(raw)||raw.length<16){state.atr=null;state.atrPct=null;return;}
    // All supported feeds are normalized to chronological order. Drop the newest candle because it may still be forming.
    const candles=raw.slice(0,-1).map(k=>({h:Number(k[2]),l:Number(k[3]),c:Number(k[4])})).filter(k=>Number.isFinite(k.h)&&Number.isFinite(k.l)&&Number.isFinite(k.c)&&k.h>=k.l&&k.c>0);
    if(candles.length<15){state.atr=null;state.atrPct=null;return;}
    const trs=[];for(let i=1;i<candles.length;i++){const c=candles[i],p=candles[i-1];trs.push(Math.max(c.h-c.l,Math.abs(c.h-p.c),Math.abs(c.l-p.c)));}
    if(trs.length<14){state.atr=null;state.atrPct=null;return;}
    // Wilder's ATR(14): seed with the first 14 true ranges, then smooth recursively (RMA), rather than averaging only the last 14 bars.
    let atr=trs.slice(0,14).reduce((a,b)=>a+b,0)/14;
    for(let i=14;i<trs.length;i++)atr=((atr*13)+trs[i])/14;
    state.atr=atr;
    const price=candles[candles.length-1].c;state.atrPct=price>0?state.atr/price*100:null;
    state.klines=raw;
  }
  function drawSparkline(raw){
    const closes=(raw||[]).slice(-36,-1).map(k=>Number(k[4])).filter(Number.isFinite);
    if(closes.length<2){$('sparkPath').setAttribute('d','');$('sparkArea').setAttribute('d','');return;}
    const min=Math.min(...closes),max=Math.max(...closes),range=max-min||1;const pts=closes.map((v,i)=>[2+i*128/(closes.length-1),40-(v-min)/range*34]);
    const d=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(2)+' '+p[1].toFixed(2)).join(' ');
    $('sparkPath').setAttribute('d',d);$('sparkArea').setAttribute('d',d+' L 130 44 L 2 44 Z');
    const a=closes[0],b=closes[closes.length-1],change=(b-a)/a*100;
    $('trendTitle').textContent=change>0.15?'近期收盘价偏强':change<-.15?'近期收盘价偏弱':'近期收盘价横向波动';
    $('trendCaption').textContent='最近 '+(closes.length)+' 根已收盘 K 线 · 区间变化 '+(change>=0?'+':'')+change.toFixed(2)+'%';
  }
  function updateMarketUI(){
    const ref=livePrice()||state.contractPrice;
    $('headerPrice').textContent=ref?fmt(ref,ref>100?2:6):'—';
    const manualPrice=Number($('manualPrice').value)>0;
    const labels={'aicoin-aggregated':'AiCoin 聚合行情参考（与币安合约可能有价差）','binance-futures':'币安 USDⓈ-M 合约公开行情','okx-swap':'OKX USDT 永续备用行情（与币安可能有价差）','gate-futures':'Gate USDT 永续备用行情（与币安可能有价差）','binance-spot':'币安现货备用行情（非合约标记价）','coinbase-spot':'Coinbase USD 现货参考（非币安合约价）','kraken-spot':'Kraken USD 现货参考（非币安合约价）'};
    const providerLabel=state.activeProvider?((labels[state.activeProvider]||'公开行情')+((state.activeRoot||'').startsWith('proxy:')?' · 公共中转':'')): '正在选择可用行情源';
    $('marketCaption').textContent=manualPrice?'手动覆盖参考价':providerLabel;
    const age=state.lastFetch?Date.now()-state.lastFetch.getTime():Infinity;
    $('priceTime').textContent=manualPrice?'手动输入':state.lastFetch?'更新于 '+state.lastFetch.toLocaleTimeString('zh-CN',{hour12:false})+(age>30000?' · 数据可能过期':''):'等待行情';
    const atrPct=effectiveAtrPct(),atr=effectiveAtr();
    $('atrOut').textContent=atr?fmt(atr, atr<1?6:3):'—';$('atrUnit').textContent=(Number($('manualAtrPct').value)>0?'手动估算 · ':((state.atrSource||'自动 K 线')+' · '))+state.symbol.replace('USDT','')+' · '+$('intervalSelect').selectedOptions[0].textContent+' ATR(14)';
    $('atrPctOut').textContent=atrPct!=null?atrPct.toFixed(3)+'%':'—';
    updateUnit();
  }
  function percentileValue(values,p){
    if(!values||!values.length)return null;
    const a=values.slice().sort((x,y)=>x-y),pos=(a.length-1)*p,lo=Math.floor(pos),hi=Math.ceil(pos);
    return a[lo]+(a[hi]-a[lo])*(pos-lo);
  }
  function estimatePullbackStats(side){
    // Sample completed, direction-specific counter-moves after confirmed local highs/lows.
    // This is a descriptive recent-history estimator, not a backtest or a predicted hit probability.
    const raw=Array.isArray(state.klines)?state.klines.slice(0,-1).slice(-100):[];
    const bars=raw.map(k=>({h:Number(k[2]),l:Number(k[3]),c:Number(k[4])})).filter(k=>Number.isFinite(k.h)&&Number.isFinite(k.l)&&Number.isFinite(k.c)&&k.h>=k.l&&k.l>0&&k.c>0);
    if(bars.length<24)return null;
    const samples=[];
    for(let i=2;i<bars.length-2;i++){
      const b=bars[i],prev=bars[i-1],prev2=bars[i-2],next=bars[i+1],next2=bars[i+2];
      if(side==='long'){
        // A confirmed swing high, followed by the deepest counter-move over the next two bars.
        const peak=b.h>prev.h&&b.h>=prev2.h&&b.h>=next.h&&b.h>=next2.h;
        if(peak){const trough=Math.min(next.l,next2.l);const pct=(b.h-trough)/b.h*100;if(Number.isFinite(pct)&&pct>0)samples.push(pct);}
      }else{
        // A confirmed swing low, followed by the strongest counter-move over the next two bars.
        const trough=b.l<prev.l&&b.l<=prev2.l&&b.l<=next.l&&b.l<=next2.l;
        if(trough){const peak=Math.max(next.h,next2.h);const pct=(peak-b.l)/b.l*100;if(Number.isFinite(pct)&&pct>0)samples.push(pct);}
      }
    }
    if(samples.length<8)return {p70:null,count:samples.length};
    return {p70:percentileValue(samples,.70),count:samples.length};
  }
  function getCallbackCandidates(entry,stop,side,validTrade){
    const atrPct=effectiveAtrPct();
    if(!validTrade)return {callback:null,desired:null,activation:null,activationR:1,conflict:false,reason:'请先填写有效的入场价和初始止损价。'};
    const distance=Math.abs(entry-stop),riskRatio=distance/entry;
    if(!(distance>0&&riskRatio>0))return {callback:null,desired:null,activation:null,activationR:1,conflict:false,reason:'初始止损距离无效。'};
    const tick=state.tickSize||.1;
    if(!(atrPct>0)){
      const activation=roundTo(side==='long'?entry+distance:entry-distance,tick,side==='long'?'up':'down');
      return {callback:null,desired:null,activation,activationR:1,conflict:false,reason:'K线或 ATR 不可用，暂时无法给出回调率建议；激活价仅按一个初始止损距离计算。'};
    }
    const history=estimatePullbackStats(side);
    // Candidate callback is the larger of one ATR as a volatility floor and the 70th percentile
    // of recent confirmed directional pullbacks; rounding upward avoids rounding the trail too tight.
    const atrFloor=atrPct;
    const historicalPullback=history&&Number.isFinite(history.p70)?history.p70:0;
    const unroundedTarget=Math.max(.1,atrFloor,historicalPullback);
    const roundedTarget=Math.max(.1,Math.ceil((unroundedTarget-1e-10)*10)/10);
    // Use 5% as a conservative recommendation cap because Binance docs/interfaces have had 5% vs 10% bounds.
    const desired=Math.min(5,roundedTarget);
    const c=desired/100;
    // On an immediate reversal after activation, reserve at least 0.5x the initial stop distance
    // as gross open profit (ignores fees/slippage); move activation later in 0.5-stop-distance steps.
    const lockDistance=.5;
    const requiredActivationMultiple=side==='long'?(c/riskRatio+lockDistance)/(1-c):(c/riskRatio+lockDistance)/(1+c);
    let activationR=Math.max(1,Math.ceil((requiredActivationMultiple-1e-9)*2)/2);
    const maxActivationR=3;
    const activationConstrained=activationR>maxActivationR;
    if(activationConstrained)activationR=maxActivationR;
    const activation=roundTo(side==='long'?entry+activationR*distance:entry-activationR*distance,tick,side==='long'?'up':'down');
    if(!(activation>0))return {callback:null,desired,activation:null,activationR,conflict:true,reason:'当前入场价与止损距离不能形成有效激活价格。'};
    const safePct=side==='long'
      ?Math.max(0,(activation-(entry+lockDistance*distance))/activation*100)
      :Math.max(0,((entry-lockDistance*distance)-activation)/activation*100);
    const safeTenth=Math.floor((safePct+1e-9)*10)/10;
    const compatibleCallback=Math.min(desired,safeTenth,5);
    // If risk geometry requires a callback materially narrower than historical noise, don't invent precision.
    const conflict=compatibleCallback<.1||compatibleCallback<roundedTarget*.8-1e-9;
    let reason='';
    if(compatibleCallback<.1)reason='在激活不晚于 3 倍初始止损距离的前提下，无法同时满足至少 0.1% 的有效回调和浮盈保护约束。建议不要机械启用跟踪止损。';
    else if(conflict)reason='最近波动估算需要约 '+roundedTarget.toFixed(1)+'% 的回调，但你的入场与止损空间最多只容纳 '+compatibleCallback.toFixed(1)+'%；两者差距过大。为避免回调过窄而容易被噪声扫出，工具暂不提供一个误导性的数字。';
    const source=history&&Number.isFinite(history.p70)?'ATR 与近期拐点回撤统计':'ATR 波动基准（历史拐点样本不足）';
    return {callback:conflict?null:compatibleCallback,desired,rawTarget:roundedTarget,unroundedTarget,activation,activationR,conflict,reason:reason||'已通过波动宽度与初始风险空间校验。',safePct,atrPct,atrFloor,historicalPullback,pullbackSamples:history?history.count:0,source,activationConstrained};
  }
  function calculate(){
    const equity=Number($('equity').value),riskPct=Number($('riskPct').value),entry=Number($('entry').value),stop=Number($('stop').value),lev=Number($('leverage').value)||1;
    const costsOn=$('includeCosts').checked,fee=Math.max(0,Number($('fee').value)||0)/100,slippage=Math.max(0,Number($('slippage').value)||0)/100;
    const validBasics=equity>0&&entry>0&&stop>0&&Number.isFinite(equity)&&Number.isFinite(entry)&&Number.isFinite(stop);
    const validDirection=state.side==='long'?stop<entry:stop>entry;
    const riskBudget=equity*riskPct/100;const distance=Math.abs(entry-stop);const distancePct=entry>0?distance/entry*100:NaN;
    let qty=0,notional=0,margin=0,loss=0,cost=0;
    if(validBasics&&validDirection&&distance>0){
      const feePerUnit=costsOn?(entry+stop)*fee:0;
      const slipPerUnit=costsOn?(entry+stop)*slippage:0;
      const unitRisk=distance+feePerUnit+slipPerUnit;
      const rawQty=riskBudget/unitRisk;
      // Without Binance exchangeInfo (common when Binance endpoints are unreachable from the user's network), show the mathematically correct theoretical quantity instead of falsely rounding with a guessed step size.
      qty=state.filtersVerified?roundTo(rawQty,state.stepSize||.001,'down'):rawQty;
      notional=qty*entry;margin=notional/lev;
      cost=qty*(feePerUnit+slipPerUnit);loss=qty*distance+cost;
    }
    $('riskOut').textContent=equity>0?fmt(riskBudget,2):'—';
    $('qtyOut').textContent=validBasics&&validDirection&&qty>0?compact(qty):'—';
    $('notionalOut').textContent=qty>0?fmt(notional,2):'—';$('marginOut').textContent=qty>0?fmt(margin,2):'—';
    $('distanceOut').textContent=validBasics&&distance>0?fmt(distance,entry<1?6:3)+' USDT':'—';
    $('distancePctOut').textContent=validBasics&&distance>0?distancePct.toFixed(3)+'%':'—';
    $('lossOut').textContent=qty>0?fmt(loss,2)+' USDT':'—';$('costOut').textContent=qty>0?fmt(cost,2)+' USDT':'—';
    $('lossOut').className=qty>0&&loss>riskBudget+0.000001?'bad-text':'';
    $('stopHint').textContent=state.side==='long'?'低于入场价':'高于入场价';
    $('stopDistanceHint').textContent=validBasics&&validDirection?'止损距离 '+fmt(distance,entry<1?6:3)+' USDT（'+distancePct.toFixed(3)+'%）':'由你根据交易结构确定，不自动猜测止损位置。';
    const w=$('riskWarning');w.classList.remove('danger');
    let msg='数量已按币安交易对步进向下取整。费用与滑点是估算值，实际止损损失可能更大。';
    if(!state.filtersVerified){msg='币安交易规则暂时无法读取，当前显示未按猜测步进取整的理论数量。下单前必须按币安实际数量步进向下取整，并核对最小数量/名义价值；不可直接把该理论数量视为合规下单数量。';w.classList.add('danger');}
    if(!validBasics){msg='请输入大于 0 的账户权益、计划入场价和初始止损价。';w.classList.add('danger');}
    else if(!validDirection){msg=state.side==='long'?'做多的初始止损价必须低于计划入场价。':'做空的初始止损价必须高于计划入场价。';w.classList.add('danger');}
    else if(qty<=0||(state.filtersVerified&&qty<(state.minQty||0))){msg='按照风险预算计算后，数量低于当前交易对的最小数量。请检查资金、止损距离或风险比例；不要为了达到最小下单量而忽略风险预算。';w.classList.add('danger');}
    else if(state.filtersVerified&&notional<(state.minNotional||0)){msg='按当前风险预算算出的名义仓位低于交易对的最小名义价值参考（约 '+fmt(state.minNotional,2)+' USDT）。不要为了满足最小名义价值而突破风险预算。';w.classList.add('danger');}
    else if(loss>riskBudget+0.005){msg='取整后估算损失略高于风险预算，请减少数量或检查手续费/滑点假设。';w.classList.add('danger');}
    $('riskWarningText').textContent=msg;
    // Callback recommendation combines a volatility allowance with a strict risk-geometry check.
    const manualAtrActive=Number($('manualAtrPct').value)>0;
    const trail=getCallbackCandidates(entry,stop,state.side,validBasics&&validDirection&&distance>0);
    const cbAtrPct=effectiveAtrPct();
    const activation=trail.conflict?null:trail.activation;
    const move=Number.isFinite(activation)?Math.abs(activation-entry):NaN;
    $('activationOut').textContent=Number.isFinite(activation)?fmt(activation,activation<1?6:3)+' USDT':'—';
    $('activationMove').textContent=trail.conflict?'当前波动与初始止损空间不匹配，暂不提供一组容易误导的激活价/回调率组合。':Number.isFinite(move)?'从入场价朝盈利方向移动约 '+trail.activationR.toFixed(1)+' 倍初始止损距离（'+fmt(move,entry<1?6:3)+' USDT）后开始跟踪。':'先输入有效入场价与初始止损价。';
    if(trail.callback!=null){
      $('callbackMain').textContent=trail.callback.toFixed(1);$('callbackUnit').textContent='%';
      $('callbackBasis').textContent=(trail.source||((manualAtrActive?'手动 ATR%':$('intervalSelect').selectedOptions[0].textContent+' ATR(14)')))+' · '+$('intervalSelect').selectedOptions[0].textContent+' · 风险校验通过';
      $('callbackExplain').textContent='候选回调宽度取“1× ATR(14)占价格比例”与“近期已确认局部高/低点后两根K线的反向波动第70百分位”中的较大值，再向上取到0.1%档；本次 ATR% '+(cbAtrPct?cbAtrPct.toFixed(3)+'%':'—')+'，历史回撤样本 '+(trail.pullbackSamples||0)+' 次。再以激活后立即反向时至少保留半个初始止损距离的毛浮盈为约束，激活距离最多后移到3倍初始止损距离。忽略手续费和滑点；这是一种透明的自适应启发式，不是回测证明的最优值。';
    }else{
      $('callbackMain').textContent=trail.conflict?'不建议':'—';$('callbackUnit').textContent='';
      $('callbackBasis').textContent=trail.conflict?'波动与风险不匹配':'等待有效 ATR(14)';
      $('callbackExplain').textContent=trail.reason||(cbAtrPct>0?'当前输入无法生成有效建议。':'暂时无法读取有效 K 线。请在“行情与波动率详情”手动填写 ATR%；不会用虚构数据代替行情。');
    }
    const current=livePrice();const age=state.lastFetch?Date.now()-state.lastFetch.getTime():Infinity;
    const manualReference=Number($('manualPrice').value)>0;
    const hasFreshReference=manualReference||(Number.isFinite(current)&&age<30000&&!!state.activeProvider);
    const referenceIsBinance=manualReference||(state.activeProvider==='binance-futures'&&!(state.activeRoot||'').startsWith('proxy:'));
    const relationOK=hasFreshReference&&Number.isFinite(current)&&Number.isFinite(activation)&&(state.side==='long'?activation>current:activation<current);
    const aw=$('activationWarning');aw.classList.remove('danger');
    let awText='以计划入场价和初始止损距离 R 推导激活价。请在下单前用币安实际下单参考价再次核对，且保留独立的初始保护止损。';
    if(trail.conflict){awText='当前波动与初始止损距离不匹配，工具没有给出激活价与回调率的组合建议。可考虑等待波动收敛、重新依据结构确定止损，或不使用跟踪止损；不要为了套用参数而放宽原始风险。';aw.classList.add('danger');}
    else if(!Number.isFinite(activation)){awText='请先输入正确方向的入场价与初始止损价，系统才能计算激活价。';aw.classList.add('danger');}
    else if(!hasFreshReference){awText='没有可验证的最新行情；激活价方向校验暂不通过。你仍可计算仓位，但不要把激活价当作已校验的币安下单参数。';aw.classList.add('danger');}
    else if(!referenceIsBinance){const providerName=({'aicoin-aggregated':'AiCoin 聚合行情参考','okx-swap':'OKX 永续合约','gate-futures':'Gate USDT 永续合约','binance-spot':'币安现货','coinbase-spot':'Coinbase 现货','kraken-spot':'Kraken 现货'})[state.activeProvider]||'备用行情';awText='当前使用 '+providerName+' 作为备用参考，和币安合约实际价格/标记价格可能有差异。下单前请用币安实际所选触发参考价复核激活价；备用行情不被视为币安价格校验通过。';aw.classList.add('danger');}
    else if(!relationOK){awText=(state.side==='long'?'做多平仓 SELL：激活价必须高于当前所选参考价。':'做空平仓 BUY：激活价必须低于当前所选参考价。')+' 当前参考价 '+fmt(current,current<1?6:3)+'，建议激活价 '+fmt(activation,activation<1?6:3)+'，不满足条件；请调整入场计划/激活 R 或等待价格变化。';aw.classList.add('danger');}
    else {awText='方向关系通过初步校验：激活价 '+fmt(activation,activation<1?6:3)+' 与当前参考价 '+fmt(current,current<1?6:3)+' 符合方向要求。行情变化后请重新核对。';}
    $('activationWarningText').textContent=awText;
    $('trailFormula').innerHTML=state.side==='long'?'<b>多单：</b>到达激活价后，记录之后的最高价；从最高价回落达到建议回调率时，触发市价平仓。':'<b>空单：</b>到达激活价后，记录之后的最低价；从最低价反弹达到建议回调率时，触发市价平仓。';
  }
  function setSide(side){state.side=side;$('longBtn').classList.toggle('active',side==='long');$('longBtn').classList.toggle('long',side==='long');$('shortBtn').classList.toggle('active',side==='short');$('shortBtn').classList.toggle('short',side==='short');calculate();}
  async function changeSymbol(){state.symbol=$('symbolSelect').value;state.atr=null;state.atrPct=null;state.klines=[];state.contractPrice=null;state.markPrice=null;state.priceLoaded=false;state.lastFetch=null;state.stepSize=.001;state.tickSize=.1;state.minQty=.001;state.minNotional=5;state.baseAsset=state.symbol.replace('USDT','');state.filtersVerified=false;updateUnit();updateMarketUI();setStatus('','正在切换交易对并测试备用行情源');await Promise.all([loadExchangeInfo(),loadMarket({klines:true})]);}
  $('aicoinConnect').addEventListener('click',async()=>{
    if(!aicoinConfigured()){showToast('请填写 AiCoin API 凭证');$('aicoinStatus').textContent='请填写 Access Key ID 与 Access Secret。不要使用任何交易所下单 API Key。';return;}
    $('aicoinStatus').textContent='正在通过 AiCoin 官方签名接口测试报价与 K 线权限…';
    state.activeProvider=null;state.activeRoot=null;state.forceAicoin=true;
    try{await loadMarket({klines:true});if(state.activeProvider!=='aicoin-aggregated'){$('aicoinStatus').textContent='AiCoin 没有成功成为当前行情源，可能是凭证、套餐接口权限、跨域或网络连接失败。请查看上方「行情连接诊断」。';}}
    catch(e){$('aicoinStatus').textContent='AiCoin 连接失败：'+(e?.message||e);}
    finally{state.forceAicoin=false;}
  });
  $('aicoinClear').addEventListener('click',()=>{$('aicoinAccessKey').value='';$('aicoinSecret').value='';state.forceAicoin=false;if(state.activeProvider==='aicoin-aggregated'){state.activeProvider=null;state.activeRoot=null;}state.marketErrors=[];$('aicoinStatus').textContent='凭证已从当前页面清除。刷新或关闭页面也会清除。';showToast('已清除 AiCoin 凭证');});
  $('themeToggle').addEventListener('click',()=>{const root=document.documentElement;const next=root.dataset.theme==='dark'?'light':'dark';root.dataset.theme=next;try{localStorage.setItem('sympact-theme',next);}catch{};const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=next==='dark'?'#171614':'#f2efe8';$('themeIcon').innerHTML=next==='dark'?'<path d="M20.2 15.1A8.5 8.5 0 0 1 8.9 3.8 8.7 8.7 0 1 0 20.2 15.1Z"/>':'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>';});
  try{const saved=localStorage.getItem('sympact-theme');if(saved==='light'){$('themeToggle').click();}}catch{}
  try{const savedMode=localStorage.getItem('sympact-connection-mode');if(savedMode==='binance'||savedMode==='mainland')state.connectionMode=savedMode;}catch{}
  $('connectionMode').value=state.connectionMode;
  $('connectionMode').addEventListener('change',async()=>{state.connectionMode=$('connectionMode').value;try{localStorage.setItem('sympact-connection-mode',state.connectionMode);}catch{};state.activeProvider=null;state.activeRoot=null;setStatus('','正在按所选策略重新测试行情源');await loadMarket({klines:true});});
  $('refreshMarket').addEventListener('click',async()=>{const b=$('refreshMarket');b.classList.add('refreshing');setStatus('','正在重试当前策略下的公开行情源');try{if(!state.filtersVerified)loadExchangeInfo().catch(e=>console.warn('Exchange rules fetch failed',e));await loadMarket({klines:true});}finally{b.classList.remove('refreshing');}});
  $('longBtn').addEventListener('click',()=>setSide('long'));$('shortBtn').addEventListener('click',()=>setSide('short'));
  $('symbolSelect').addEventListener('change',changeSymbol);
  $('workingType').addEventListener('change',()=>{updateMarketUI();if($('followMarket').checked&&livePrice())$('entry').value=String(livePrice());calculate();});
  $('followMarket').addEventListener('change',()=>{if($('followMarket').checked){delete $('entry').dataset.userEdited;if(livePrice())$('entry').value=String(livePrice());}calculate();});
  $('intervalSelect').addEventListener('change',()=>loadMarket({klines:true}));
  $('manualPrice').addEventListener('input',()=>{updateMarketUI();calculate();});
  $('manualAtrPct').addEventListener('input',()=>{updateMarketUI();calculate();});
  $('riskPct').addEventListener('change',calculate);$('includeCosts').addEventListener('change',calculate);
  ['equity','entry','stop','leverage','fee','slippage'].forEach(id=>$(id).addEventListener('input',()=>{if(id==='entry'&&document.activeElement===$('entry')){$('followMarket').checked=false;$('entry').dataset.userEdited='1';}calculate();}));
  $('copyBtn').addEventListener('click',async()=>{
    const card=[`SYMPACT RISK DESK · ${state.symbol}`,`方向：${state.side==='long'?'做多 LONG':'做空 SHORT'}`,`账户权益：${$('equity').value||'—'} USDT`,`入场价：${$('entry').value||'—'}`,`初始止损：${$('stop').value||'—'}`,`单笔风险比例：${$('riskPct').value}%`,`风险预算：${$('riskOut').textContent} USDT`,`建议数量：${$('qtyOut').textContent} ${state.baseAsset}`,`名义仓位：${$('notionalOut').textContent} USDT`,`杠杆参考：${$('leverage').value}x`,`跟踪激活价：${$('activationOut').textContent}`,`建议回调率：${$('callbackUnit').textContent?$('callbackMain').textContent+'%':$('callbackMain').textContent}`,`ATR周期：${$('intervalSelect').selectedOptions[0].textContent}`,`触发参考：${$('workingType').selectedOptions[0].textContent}`,`提示：跟踪止损不替代初始保护止损；最终参数请在币安下单界面核对。`].join('\n');
    try{await navigator.clipboard.writeText(card);showToast('执行卡已复制');}catch(e){const ta=document.createElement('textarea');ta.value=card;document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();showToast(ok?'执行卡已复制':'复制失败，请手动复制');}
  });
  // Restore the last successful snapshot for near-instant warm starts; live data replaces it when available.
  if(previousFastCache&&previousFastCache.symbol===state.symbol&&Number(previousFastCache.contractPrice)>0){
    state.contractPrice=Number(previousFastCache.contractPrice);state.markPrice=Number(previousFastCache.markPrice)||null;
    state.activeProvider=previousFastCache.provider||null;state.activeRoot=previousFastCache.root||null;state.priceLoaded=true;
    state.lastFetch=Number(previousFastCache.lastFetch)>0?new Date(Number(previousFastCache.lastFetch)):new Date();
    if(Array.isArray(previousFastCache.klines)&&previousFastCache.klines.length>=16){state.klines=previousFastCache.klines;computeATR(state.klines);drawSparkline(state.klines);}
    updateMarketUI();calculate();setStatus('warn','已显示上次行情 · 正在验证实时数据');
  }
  // Initial boot and lightweight refresh; public endpoints only, no API key.
  // Keep the first-visit shell visible long enough for the browser to paint it, then reveal the app without waiting for market APIs.
  requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(()=>{const splash=$('startupSplash');if(splash){splash.classList.add('is-hidden');setTimeout(()=>splash.remove(),260);}},450)));
  (async()=>{loadExchangeInfo().catch(e=>console.warn('Exchange rules fetch failed',e));await loadMarket({klines:!Array.isArray(previousFastCache?.klines)||previousFastCache.klines.length<16});state.timer=setInterval(()=>loadMarket({klines:false}),10000);state.klineTimer=setInterval(()=>loadMarket({klines:true}),60000);})();
})();
