const messages={
  invalid:'登录名或密码不正确，或账户已停用。',
  busy:'登录尝试过多，请稍后重试。',
  unavailable:'登录服务暂不可用，请稍后重试。',
};
const url=new URL(location.href);
document.getElementById('loginReturn').value=url.pathname+url.hash;
const failure=url.searchParams.get('loginError');
if(Object.hasOwn(messages,failure)){
  const notice=document.getElementById('loginError');
  notice.textContent=messages[failure];
  notice.hidden=false;
  url.searchParams.delete('loginError');
  history.replaceState(history.state,'',url.pathname+url.search+url.hash);
}
