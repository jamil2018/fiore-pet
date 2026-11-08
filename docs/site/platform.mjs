// iPadOS can report itself as a Mac; touch points distinguish its desktop UA.
export function detectPlatform({
  userAgent = "",
  platform = "",
  maxTouchPoints = 0,
  userAgentData,
} = {}) {
  if (userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(userAgent))
    return "unsupported";
  const name = userAgentData?.platform || platform || userAgent;
  if (/Mac/i.test(name) && maxTouchPoints > 1) return "unsupported";
  if (/Win/i.test(name)) return "windows";
  if (/Mac/i.test(name)) return "mac";
  return "unsupported";
}
