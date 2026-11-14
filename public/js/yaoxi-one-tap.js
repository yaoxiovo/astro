(() => {
  'use strict';
  if(window.__blogOneTap||location.origin!=='https://blog.yaoxi.wiki')return;
  window.__blogOneTap=true;
  const provider='https://account.yaoxi.wiki';
  async function boot(){
    for(let i=0;i<30&&!window.yaoxiAuth;i++)await new Promise(resolve=>setTimeout(resolve,100));
    const existing=window.yaoxiAuth;
    if(existing)existing.authUrl=provider;
    const token=existing?.getToken?.()||localStorage.getItem('yaoxi_auth_token');
    if(token){
      try{
        const response=await fetch(provider+'/api/auth/introspect',{method:'POST',headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'omit'});
        const data=await response.json();
        if(response.ok&&data.active===true&&data.aud==='yaoxi-blog')return;
        if(response.ok&&data.active===false)existing?.logout?.();
      }catch{}
    }
    const legacy=window.YaoxiAuth;
    const Constructor=await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=provider+'/sdk/yaoxi-auth.js?v=blog-onetap-20261114';script.onload=()=>resolve(window.YaoxiAuth);script.onerror=()=>reject(new Error('One Tap SDK 加载失败'));document.head.append(script);});
    if(legacy)window.YaoxiAuth=legacy;
    const oneTap=new Constructor({clientId:'yaoxi-blog',authUrl:provider,redirectUri:'https://blog.yaoxi.wiki',scope:'openid profile email'});
    window.__blogOneTapAuth=oneTap;
    await oneTap.promptOneTap({force:true,persist:false,onSuccess:result=>{
      if(existing?._saveAuthData)existing._saveAuthData(result.access_token,result.user,result.expires_in,{},{});
      else{oneTap._saveAuthData(result.access_token,result.user,result.expires_in,{});localStorage.setItem('yaoxi_access_token',result.access_token);localStorage.setItem('access_token',result.access_token);}
      window.dispatchEvent(new CustomEvent('yaoxi:auth:change',{detail:{isAuthenticated:true,user:result.user,token:result.access_token}}));
      location.reload();
    },onError:error=>console.warn('[yaoxi One Tap]',error.message)});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>boot().catch(e=>console.warn('[yaoxi One Tap]',e.message)),{once:true});else boot().catch(e=>console.warn('[yaoxi One Tap]',e.message));
})();
