import { EXTRA_ORIGINS, KR_FLAG, KR_ORIGINS } from '../shared/messages';

const btn = document.getElementById('grant') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLParagraphElement;
const kr = document.getElementById('kr') as HTMLInputElement;
const krStatus = document.getElementById('kr-status') as HTMLParagraphElement;

async function refresh() {
  const ok = await chrome.permissions.contains({ origins: EXTRA_ORIGINS });
  status.textContent = ok ? '허용됐어요. YouTube 탭을 새로고침하세요.' : '';
  btn.hidden = ok;
  const on = (await chrome.storage.local.get(KR_FLAG))[KR_FLAG] === true;
  kr.checked = on && (await chrome.permissions.contains({ origins: KR_ORIGINS }));
}

btn.addEventListener('click', async () => {
  // must run inside the click (user gesture)
  const ok = await chrome.permissions.request({ origins: EXTRA_ORIGINS });
  if (!ok) status.textContent = '허용하지 않으면 일부 곡의 가사를 찾지 못해요.';
  await refresh();
});

kr.addEventListener('change', async () => {
  if (kr.checked) {
    // request first, synchronously inside the user gesture
    const ok = await chrome.permissions.request({ origins: KR_ORIGINS }).catch(() => false);
    await chrome.storage.local.set({ [KR_FLAG]: ok });
    krStatus.textContent = ok ? '켜졌어요. 다음 곡부터 국내 가사 소스를 함께 찾아요.' : '권한을 허용하지 않아 켜지 못했어요.';
  } else {
    await chrome.storage.local.set({ [KR_FLAG]: false });
    await chrome.permissions.remove({ origins: KR_ORIGINS }).catch(() => false);
    krStatus.textContent = '꺼졌어요.';
  }
  await refresh();
});
void refresh();
