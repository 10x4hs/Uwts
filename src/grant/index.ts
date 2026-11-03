import { EXTRA_ORIGINS } from '../shared/messages';

const btn = document.getElementById('grant') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLParagraphElement;

async function refresh() {
  const ok = await chrome.permissions.contains({ origins: EXTRA_ORIGINS });
  status.textContent = ok ? '허용됐어요. 이 탭을 닫고 YouTube 탭을 새로고침하세요.' : '';
  btn.hidden = ok;
}

btn.addEventListener('click', async () => {
  // must run inside the click (user gesture)
  const ok = await chrome.permissions.request({ origins: EXTRA_ORIGINS });
  if (!ok) status.textContent = '허용하지 않으면 일부 곡의 가사를 찾지 못해요.';
  await refresh();
});
void refresh();
