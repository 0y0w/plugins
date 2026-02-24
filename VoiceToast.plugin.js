/**
 * @name VoiceToast
 * @version 1.3.4
 * @author wi050(y0)
 * @authorId 859300569905627148
 * @description Adds Toast Windows to your selected Voice Channel to Findout Who Join or Leave. Rewrite from VoiceEvents by DevYukine.
 */

"use strict";

const PLUGIN_KEY = "VoiceToast";
const load = (k) => BdApi.Data.load(PLUGIN_KEY, k);
const save = (k, v) => BdApi.Data.save(PLUGIN_KEY, k, v);

const byName = (name) =>
  BdApi.Webpack.getModule((m) => (m?.displayName ?? m?.constructor?.displayName) === name);

const ChannelStore = byName("ChannelStore");
const SelectedChannelStore = byName("SelectedChannelStore");
const VoiceStateStore = byName("VoiceStateStore");
const GuildMemberStore = byName("GuildMemberStore");
const MediaEngineStore = byName("MediaEngineStore");
const UserStore = byName("UserStore");

const { React } = BdApi;

/* =======================
   Settings
======================= */

const DEFAULTS = {
  filterNames: false,
  filterBots: false,
  filterStages: true,
  toast: {
    type: "info", // info | success | warning | error
    timeout: 3000, // ms
  },
  notifs: {
    mute: { enabled: true, message: "靜音" },
    unmute: { enabled: true, message: "取消靜音" },
    deafen: { enabled: true, message: "拒聽" },
    undeafen: { enabled: true, message: "取消拒聽" },
    join: { enabled: true, message: "$user 加入了 $channel" },
    leave: { enabled: true, message: "$user 離開了 $channel" },
    // store-listener 模式下這三個不一定能 100% 精準觸發，但仍保留設定
    joinSelf: { enabled: true, message: "你 加入了 $channel" },
    moveSelf: { enabled: true, message: "你 被移動至 $channel" },
    leaveSelf: { enabled: true, message: "你 離開了 $channel" },
  },
  unknownChannel: "The call",
};

class SettingsStore {
  constructor(defaults) {
    this.defaults = defaults;
    this.current = structuredClone(defaults);
  }
  load() {
    const saved = load("settings") || {};
    this.current = {
      ...structuredClone(this.defaults),
      ...saved,
      toast: { ...structuredClone(this.defaults.toast), ...(saved.toast || {}) },
      notifs: { ...structuredClone(this.defaults.notifs), ...(saved.notifs || {}) },
    };
  }
  save() {
    save("settings", this.current);
  }
  reset() {
    this.current = structuredClone(this.defaults);
    this.save();
  }
}
const Settings = new SettingsStore(DEFAULTS);

/* =======================
   Toast
======================= */

const toast = (msg) => {
  const t = Settings.current.toast;
  BdApi.UI.showToast(msg, { type: t.type, timeout: t.timeout });
};

/* =======================
   Helpers
======================= */

const processName = (n) =>
  Settings.current.filterNames
    ? String(n).replace(/[^a-zA-Z0-9\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/g, " ")
    : String(n);

const notify = (type, userId, channelId) => {
  const s = Settings.current;
  const n = s.notifs[type];
  if (!n?.enabled) return;

  const user = UserStore.getUser(userId);
  const channel = ChannelStore.getChannel(channelId);

  if ((s.filterBots && user?.bot) || (s.filterStages && channel?.isGuildStageVoice?.())) return;

  const nick =
    GuildMemberStore.getMember(channel?.getGuildId?.(), userId)?.nick ??
    user?.globalName ??
    user?.username ??
    "User";

  const channelName =
    !channel || channel.isDM?.() || channel.isGroupDM?.() ? s.unknownChannel : channel.name;

  const msg = String(n.message || "")
    .replaceAll("$user", processName(nick))
    .replaceAll("$channel", processName(channelName))
    .replaceAll("$username", processName(user?.username ?? "User"));

  toast(msg);
};

/* =======================
   Store-based tracking (BD 1.13.5 safe)
======================= */

let prevVoiceStates = {};
let prevSelectedChannelId = null;

function onVoiceStatesChanged() {
  const selfId = UserStore.getCurrentUser().id;
  const selected = SelectedChannelStore.getVoiceChannelId();

  // if channel changed, refresh snapshot
  if (selected !== prevSelectedChannelId) {
    prevSelectedChannelId = selected;
    prevVoiceStates = selected ? { ...VoiceStateStore.getVoiceStatesForChannel(selected) } : {};
    return;
  }

  if (!selected) return;

  const current = VoiceStateStore.getVoiceStatesForChannel(selected);
  const prev = prevVoiceStates;

  // join/leave for others in the selected channel
  for (const uid of Object.keys(current)) {
    if (!prev[uid] && uid !== selfId) notify("join", uid, selected);
  }
  for (const uid of Object.keys(prev)) {
    if (!current[uid] && uid !== selfId) notify("leave", uid, selected);
  }

  prevVoiceStates = { ...current };
}

let prevSelfMute = null;
let prevSelfDeaf = null;

function onMediaEngineChanged() {
  const selfId = UserStore.getCurrentUser().id;
  const channelId = SelectedChannelStore.getVoiceChannelId();

  const isMute = !!MediaEngineStore.isSelfMute?.();
  const isDeaf = !!MediaEngineStore.isSelfDeaf?.();

  if (prevSelfMute !== null && isMute !== prevSelfMute) {
    notify(isMute ? "mute" : "unmute", selfId, channelId);
  }
  if (prevSelfDeaf !== null && isDeaf !== prevSelfDeaf) {
    notify(isDeaf ? "deafen" : "undeafen", selfId, channelId);
  }

  prevSelfMute = isMute;
  prevSelfDeaf = isDeaf;
}

function addStoreListener(store, fn) {
  if (!store) return false;
  if (typeof store.addChangeListener === "function") { store.addChangeListener(fn); return true; }
  if (typeof store.addReactChangeListener === "function") { store.addReactChangeListener(fn); return true; }
  return false;
}
function removeStoreListener(store, fn) {
  if (!store) return;
  if (typeof store.removeChangeListener === "function") { store.removeChangeListener(fn); return; }
  if (typeof store.removeReactChangeListener === "function") { store.removeReactChangeListener(fn); return; }
}

/* =======================
   Full Settings Panel (same content style as before)
======================= */

const titles = {
  mute: "Mute (Self)",
  unmute: "Unmute (Self)",
  deafen: "Deafen (Self)",
  undeafen: "Undeafen (Self)",
  join: "Join (Other Users)",
  leave: "Leave (Other Users)",
  joinSelf: "Join (Self)",
  moveSelf: "Move (Self)",
  leaveSelf: "Leave (Self)",
};

function SettingsPanel() {
  const [state, setState] = React.useState(() => Settings.current);

  const commit = (next) => {
    Settings.current = next;
    Settings.save();
    setState(next);
  };

  const setToastType = (type) => commit({ ...state, toast: { ...state.toast, type } });
  const setToastTimeout = (timeout) =>
    commit({
      ...state,
      toast: { ...state.toast, timeout: Math.max(0, Number(timeout) || 0) },
    });

  const setFlag = (key, val) => commit({ ...state, [key]: !!val });

  const setUnknownChannel = (val) => commit({ ...state, unknownChannel: val });

  const setNotifEnabled = (key, enabled) =>
    commit({
      ...state,
      notifs: { ...state.notifs, [key]: { ...state.notifs[key], enabled: !!enabled } },
    });

  const setNotifMessage = (key, message) =>
    commit({
      ...state,
      notifs: { ...state.notifs, [key]: { ...state.notifs[key], message } },
    });

  const sectionStyle = {
    padding: "12px 0",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  };

  const rowStyle = {
    display: "flex",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    margin: "8px 0",
  };

  const labelStyle = { fontWeight: 600, fontSize: 14 };
  const subStyle = { opacity: 0.75, fontSize: 12, marginTop: 4, lineHeight: 1.4 };

  const inputStyle = {
    width: "100%",
    maxWidth: 520,
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.25)",
    color: "inherit",
  };

  const smallInputStyle = { ...inputStyle, maxWidth: 220 };

  const buttonStyle = {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "inherit",
    cursor: "pointer",
  };

  const h2Style = { fontSize: 16, fontWeight: 800, margin: "0 0 8px" };

  return React.createElement(
    "div",
    { style: { padding: 16 } },

    // Toast
    React.createElement(
      "div",
      { style: sectionStyle },
      React.createElement("div", { style: h2Style }, "Toast"),
      React.createElement(
        "div",
        { style: rowStyle },
        React.createElement("div", null, React.createElement("div", { style: labelStyle }, "Type")),
        React.createElement(
          "select",
          {
            style: smallInputStyle,
            value: state.toast.type,
            onChange: (e) => setToastType(e.target.value),
          },
          ["info", "success", "warning", "error"].map((t) =>
            React.createElement("option", { key: t, value: t }, t)
          )
        )
      ),
      React.createElement(
        "div",
        { style: rowStyle },
        React.createElement("div", null, React.createElement("div", { style: labelStyle }, "Timeout (ms)")),
        React.createElement("input", {
          style: smallInputStyle,
          type: "number",
          min: 0,
          step: 100,
          value: state.toast.timeout,
          onChange: (e) => setToastTimeout(e.target.value),
        })
      ),
      React.createElement(
        "div",
        { style: rowStyle },
        React.createElement("div", { style: subStyle }, "Preview current toast settings."),
        React.createElement(
          "button",
          { style: buttonStyle, onClick: () => toast("VoiceToast toast test") },
          "Test"
        )
      )
    ),

    // Filters
    React.createElement(
      "div",
      { style: sectionStyle },
      React.createElement("div", { style: h2Style }, "Filters"),
      React.createElement(
        "div",
        { style: rowStyle },
        React.createElement(
          "div",
          null,
          React.createElement("div", { style: labelStyle }, "Name Filter"),
          React.createElement(
            "div",
            { style: subStyle },
            "Allow English, numbers, Chinese, Japanese, and Korean characters. Other symbols will be filtered."
          )
        ),
        React.createElement("input", {
          type: "checkbox",
          checked: !!state.filterNames,
          onChange: (e) => setFlag("filterNames", e.target.checked),
        })
      ),
      React.createElement(
        "div",
        { style: rowStyle },
        React.createElement(
          "div",
          null,
          React.createElement("div", { style: labelStyle }, "Bot Filter"),
          React.createElement("div", { style: subStyle }, "Disable notifications for bot users in voice.")
        ),
        React.createElement("input", {
          type: "checkbox",
          checked: !!state.filterBots,
          onChange: (e) => setFlag("filterBots", e.target.checked),
        })
      ),
      React.createElement(
        "div",
        { style: rowStyle },
        React.createElement(
          "div",
          null,
          React.createElement("div", { style: labelStyle }, "Stage Filter"),
          React.createElement("div", { style: subStyle }, "Disable notifications for stage voice channels.")
        ),
        React.createElement("input", {
          type: "checkbox",
          checked: !!state.filterStages,
          onChange: (e) => setFlag("filterStages", e.target.checked),
        })
      )
    ),

    // Notifications
    React.createElement(
      "div",
      { style: sectionStyle },
      React.createElement("div", { style: h2Style }, "Notifications"),
      React.createElement(
        "div",
        { style: subStyle },
        "Variables: ",
        React.createElement("code", null, "$user"),
        ", ",
        React.createElement("code", null, "$username"),
        ", ",
        React.createElement("code", null, "$channel")
      ),
      ...Object.keys(titles).map((k) =>
        React.createElement(
          "div",
          {
            key: k,
            style: {
              marginTop: 12,
              padding: 12,
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.08)",
            },
          },
          React.createElement("div", { style: { ...labelStyle, marginBottom: 8 } }, titles[k]),
          React.createElement(
            "div",
            { style: rowStyle },
            React.createElement("input", {
              style: inputStyle,
              type: "text",
              value: state.notifs[k].message,
              onChange: (e) => setNotifMessage(k, e.target.value),
            }),
            React.createElement("input", {
              type: "checkbox",
              checked: !!state.notifs[k].enabled,
              onChange: (e) => setNotifEnabled(k, e.target.checked),
              title: "Enabled",
            }),
            React.createElement(
              "button",
              {
                style: buttonStyle,
                onClick: () =>
                  toast(
                    String(state.notifs[k].message || "")
                      .split("$user").join("user")
                      .split("$channel").join("channel")
                      .split("$username").join("username")
                  ),
              },
              "Test"
            )
          )
        )
      )
    ),

    // Unknown Channel
    React.createElement(
      "div",
      { style: sectionStyle },
      React.createElement("div", { style: h2Style }, "Unknown Channel Name"),
      React.createElement(
        "div",
        { style: subStyle },
        "Used when channel name can't be resolved (DM/Group/unknown)."
      ),
      React.createElement(
        "div",
        { style: rowStyle },
        React.createElement("input", {
          style: inputStyle,
          type: "text",
          value: state.unknownChannel,
          onChange: (e) => setUnknownChannel(e.target.value),
        }),
        React.createElement(
          "button",
          { style: buttonStyle, onClick: () => toast(state.unknownChannel) },
          "Test"
        )
      )
    ),

    // Reset
    React.createElement(
      "div",
      { style: { paddingTop: 12 } },
      React.createElement(
        "button",
        {
          style: buttonStyle,
          onClick: () => {
            Settings.reset();
            Settings.load();
            setState(Settings.current);
            toast("Settings reset");
          },
        },
        "Reset Settings"
      )
    )
  );
}

/* =======================
   Plugin class
======================= */

module.exports = class VoiceToast {
  start() {
    Settings.load();

    // init snapshots
    prevSelectedChannelId = SelectedChannelStore.getVoiceChannelId();
    prevVoiceStates = prevSelectedChannelId
      ? { ...VoiceStateStore.getVoiceStatesForChannel(prevSelectedChannelId) }
      : {};

    prevSelfMute = !!MediaEngineStore.isSelfMute?.();
    prevSelfDeaf = !!MediaEngineStore.isSelfDeaf?.();

    // attach listeners
    this._voiceOk = addStoreListener(VoiceStateStore, onVoiceStatesChanged);
    this._selOk = addStoreListener(SelectedChannelStore, onVoiceStatesChanged);
    this._mediaOk = addStoreListener(MediaEngineStore, onMediaEngineChanged);

    if (!this._voiceOk && !this._selOk) {
      toast("VoiceToast: VoiceStateStore listener not available (Discord update).");
    } else {
      toast("VoiceToast enabled");
    }
  }

  stop() {
    removeStoreListener(VoiceStateStore, onVoiceStatesChanged);
    removeStoreListener(SelectedChannelStore, onVoiceStatesChanged);
    removeStoreListener(MediaEngineStore, onMediaEngineChanged);

    prevVoiceStates = {};
    prevSelectedChannelId = null;
    prevSelfMute = null;
    prevSelfDeaf = null;
  }

  getSettingsPanel() {
    // BD sometimes asks panel before start()
    try { Settings.load(); } catch (_) {}
    return React.createElement(SettingsPanel, null);
  }
};
