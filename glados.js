/*
 * GLaDOS Quantumult X 签到脚本（稳定版）
 * 使用现有配置即可，无需更换 GLaDOS_Cookie 存储键。
 */

const CONFIG = {
  cookieKey: "GLaDOS_Cookie",
  checkinUrl: "https://glados.cloud/api/user/checkin",
  statusUrl: "https://glados.cloud/api/user/status",
  consoleUrl: "https://glados.cloud/console/checkin",
  tokens: ["glados.network", "glados.cloud", "glados.one"],
  timeoutMs: 15000,
  retryCount: 2,
  notifyOnCookieUnchanged: false,
  notifyOnAlreadyChecked: true,
  lowDaysWarning: 7
};

const $ = {
  read: key => $prefs.valueForKey(key),
  write: (value, key) => $prefs.setValueForKey(value, key),
  remove: key => $prefs.removeValueForKey(key),
  notify: (subtitle, body, options) => $notify("GLaDOS", subtitle, body, options),
  request: options => $task.fetch({ timeout: CONFIG.timeoutMs, ...options }),
  done: value => $done(value || {})
};

main()
  .catch(error => {
    console.log(`[GLaDOS] 未处理异常：${safeError(error)}`);
    $.notify("❌ 脚本异常", "请在 Quantumult X 日志中查看原因。", {
      "open-url": CONFIG.consoleUrl
    });
  })
  .finally(() => $.done());

async function main() {
  if (typeof $request !== "undefined") {
    captureCookie();
    return;
  }

  const cookie = $.read(CONFIG.cookieKey);
  if (!cookie) {
    notifyCookieRequired("尚未获取登录信息");
    return;
  }

  console.log("[GLaDOS] 开始签到");
  const result = await performCheckin(cookie);

  if (result.type === "success" || result.type === "already") {
    const status = await fetchStatus(cookie);
    notifyResult(result, status);
    return;
  }

  if (result.type === "unauthorized") {
    $.remove(CONFIG.cookieKey);
    notifyCookieRequired("登录信息已失效");
    return;
  }

  const detail = result.message || "请求失败，请稍后手动运行一次。";
  $.notify("❌ 签到失败", detail, { "open-url": CONFIG.consoleUrl });
}

function captureCookie() {
  const headers = ($request && $request.headers) || {};
  const cookie = headers.Cookie || headers.cookie;

  if (!cookie || !cookie.trim()) {
    console.log("[GLaDOS] 请求中没有 Cookie，未保存");
    return;
  }

  const oldCookie = $.read(CONFIG.cookieKey);
  if (oldCookie === cookie) {
    console.log("[GLaDOS] Cookie 未变化");
    if (CONFIG.notifyOnCookieUnchanged) {
      $.notify("ℹ️ 登录信息未变化", "原有 Cookie 仍在使用。", {
        "open-url": CONFIG.consoleUrl
      });
    }
    return;
  }

  const saved = $.write(cookie, CONFIG.cookieKey);
  if (saved) {
    $.notify("✅ 获取 Cookie 成功", "以后会按配置自动签到。", {
      "open-url": CONFIG.consoleUrl
    });
  } else {
    $.notify("❌ Cookie 保存失败", "请重新打开签到页面再试一次。", {
      "open-url": CONFIG.consoleUrl
    });
  }
}

async function performCheckin(cookie) {
  let lastMessage = "";

  for (const token of CONFIG.tokens) {
    const response = await requestWithRetry({
      url: CONFIG.checkinUrl,
      method: "POST",
      headers: commonHeaders(cookie),
      body: JSON.stringify({ token })
    });

    if (!response.ok) {
      if (response.unauthorized) return { type: "unauthorized" };
      lastMessage = response.message;
      continue;
    }

    const data = response.data;
    const message = textOf(data.message, "服务端未返回说明");
    console.log(`[GLaDOS] Token ${token} 返回 code=${String(data.code)}`);

    if (/please\s+checkin\s+via/i.test(message)) {
      lastMessage = "签到口令已变更，已尝试备用口令。";
      continue;
    }

    if (Number(data.code) === 0) {
      return { type: "success", message, balance: extractBalance(data) };
    }

    if (Number(data.code) === 1 || /already|已签到|重复/i.test(message)) {
      return { type: "already", message, balance: extractBalance(data) };
    }

    if (/login|unauthorized|cookie|登录|未认证|过期/i.test(message)) {
      return { type: "unauthorized" };
    }

    lastMessage = `服务端返回：${message}`;
  }

  return { type: "failed", message: lastMessage || "所有签到口令均未成功。" };
}

async function fetchStatus(cookie) {
  const response = await requestWithRetry({
    url: CONFIG.statusUrl,
    method: "GET",
    headers: commonHeaders(cookie)
  });

  if (!response.ok || Number(response.data.code) !== 0) {
    return { ok: false };
  }

  const rawDays = response.data && response.data.data && response.data.data.leftDays;
  const days = Number.parseFloat(rawDays);
  return { ok: true, days: Number.isFinite(days) ? days : null };
}

async function requestWithRetry(options) {
  let lastError = "";

  for (let attempt = 1; attempt <= CONFIG.retryCount; attempt += 1) {
    try {
      const response = await $.request(options);
      const status = Number(response.statusCode || response.status || 0);

      if (status === 401 || status === 403) {
        return { ok: false, unauthorized: true, message: `登录状态失效（HTTP ${status}）` };
      }

      if (status < 200 || status >= 300) {
        lastError = `服务器响应异常（HTTP ${status || "未知"}）`;
        continue;
      }

      const parsed = parseJson(response.body);
      if (!parsed.ok) {
        lastError = "服务器返回了无法识别的内容。";
        continue;
      }

      return { ok: true, data: parsed.data };
    } catch (error) {
      lastError = `网络请求失败：${safeError(error)}`;
      console.log(`[GLaDOS] 第 ${attempt} 次请求失败：${safeError(error)}`);
    }
  }

  return { ok: false, message: lastError || "网络请求失败。" };
}

function notifyResult(result, status) {
  if (result.type === "already" && !CONFIG.notifyOnAlreadyChecked) return;

  const subtitle = result.type === "success" ? "✅ 签到成功" : "☑️ 今日已签到";
  const details = [];

  if (status.ok && status.days !== null) {
    details.push(`⏳ 剩余天数：${formatNumber(status.days)} 天`);
    if (status.days <= CONFIG.lowDaysWarning) details.push("⚠️ 剩余时间不多，请留意续期");
  } else {
    details.push("⏳ 剩余天数：获取失败");
  }

  if (result.balance !== null) details.push(`💎 当前积分：${formatNumber(result.balance)}`);
  if (result.message) details.push(`ℹ️ ${result.message}`);

  $.notify(subtitle, details.join("\n"), { "open-url": CONFIG.consoleUrl });
}

function notifyCookieRequired(reason) {
  $.notify(`❌ ${reason}`, "请点击通知打开签到页面，登录后刷新一次。", {
    "open-url": CONFIG.consoleUrl
  });
}

function commonHeaders(cookie) {
  return {
    Cookie: cookie,
    "Content-Type": "application/json;charset=utf-8",
    Origin: "https://glados.cloud",
    Referer: `${CONFIG.consoleUrl}/`,
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
  };
}

function extractBalance(data) {
  const value = data && Array.isArray(data.list) && data.list[0] && data.list[0].balance;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function parseJson(body) {
  try {
    return { ok: true, data: JSON.parse(body || "{}") };
  } catch (_) {
    return { ok: false };
  }
}

function textOf(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function safeError(error) {
  if (!error) return "未知错误";
  return String(error.message || error).slice(0, 200);
}
