import React, { useEffect, useState } from 'react';
import { Clapperboard, X, Upload, Plus, Trash2, Image as ImageIcon } from 'lucide-react';
import useStore from '../../store/useStore';
import useCollabChannel from '../../hooks/useCollabChannel';
import { EVENTS } from '../../utils/constants';
import {
  sanitizeBroadcastOverlay,
  loadBroadcastOverlay,
  saveBroadcastOverlay,
  textToTickerItems,
  tickerItemsToText
} from '../../utils/broadcastOverlay';

// Host-only configuration panel for the news-style broadcast graphics
// (ticker / bug / super). Every change is:
//   1. sanitized + written to the store (renders BroadcastOverlay + the
//      recording/RTMP canvas compositor immediately),
//   2. persisted to localStorage (survives the host's refresh),
//   3. broadcast over the existing collab relay so participants render the
//      same graphics (channel EVENTS.BROADCAST_OVERLAY_CHANNEL).
// The guest-side half lives in BroadcastOverlay.jsx (collab receive).
const MAX_LOGO_EDGE = 512;

// <input type="file"> -> small data: URL. Uploaded logos are downscaled to at
// most 512px on the longest edge and re-encoded as PNG so the collab payload
// (which also carries the image) stays far under the socket.io 1MB message
// cap and localStorage quota.
function fileToLogoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, MAX_LOGO_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/png'));
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Not a readable image file'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const TICKER_POSITIONS = [
  { value: 'bottom', label: 'Bottom' },
  { value: 'top', label: 'Top' }
];
const BUG_POSITIONS = [
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'bottom-right', label: 'Bottom Right' },
  { value: 'top-left', label: 'Top Left' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'custom', label: 'Custom (drag on stage)' }
];
const SUPER_POSITIONS = [
  { value: 'lower-left', label: 'Lower Left' },
  { value: 'lower-center', label: 'Lower Center' },
  { value: 'lower-right', label: 'Lower Right' },
  { value: 'custom', label: 'Custom (drag on stage)' }
];

export default function BroadcastConfig() {
  const isHost = useStore((s) => s.isHost);
  const overlay = useStore((s) => s.broadcastOverlay);
  const setBroadcastOverlay = useStore((s) => s.setBroadcastOverlay);
  const participantCount = useStore((s) => s.participants.size);
  const [expanded, setExpanded] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const { send } = useCollabChannel(EVENTS.BROADCAST_OVERLAY_CHANNEL);

  // Host-only recovery: rehydrate the persisted config (refresh-proof) and
  // re-broadcast it so late joiners get the same graphics. Repair-only on
  // mount: the store is the live source of truth afterwards.
  useEffect(() => {
    if (!isHost) return;
    const stored = loadBroadcastOverlay();
    setBroadcastOverlay(stored);
    send(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost]);

  // Participants joining mid-meeting missed the mount broadcast; re-push the
  // current config whenever the roster changes (host's panel is always mounted
  // in the room, collapsed or not).
  useEffect(() => {
    if (!isHost) return;
    send(useStore.getState().broadcastOverlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, participantCount]);

  if (!isHost) return null;

  // Commit one section patch: sanitize against the defaults, then store +
  // persist + broadcast. `section` is 'ticker' | 'bug' | 'supers'.
  const update = (section, changes) => {
    const next = sanitizeBroadcastOverlay({
      ...useStore.getState().broadcastOverlay,
      [section]: {
        ...useStore.getState().broadcastOverlay[section],
        ...changes
      }
    });
    setBroadcastOverlay(next);
    saveBroadcastOverlay(next);
    send(next);
  };

  const handleLogoFile = async (file) => {
    if (!file) return;
    setLogoBusy(true);
    try {
      const src = await fileToLogoDataUrl(file);
      update('bug', { src });
    } catch (err) {
      console.error('[Broadcast] Logo upload failed:', err.message);
    } finally {
      setLogoBusy(false);
    }
  };

  const sectionHeader = (icon, title) => (
    <div className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">
      {icon}
      <span>{title}</span>
    </div>
  );

  const toggleRow = (enabled, onChange) => (
    <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-gray-300 w-fit">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-primary"
      />
      Enabled
    </label>
  );

  const numberField = (label, value, min, max, onChange, step = 1) => (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full bg-meeting-bg border border-meeting-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-primary/50"
      />
    </label>
  );

  const colorField = (label, value, onChange) => (
    <label className="flex items-center gap-1.5">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-7 rounded bg-meeting-bg border border-meeting-border cursor-pointer"
      />
      <span className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</span>
    </label>
  );

  const t = overlay.ticker;
  const b = overlay.bug;
  const s = overlay.supers;

  return (
    <div className="max-w-3xl mx-auto px-2 sm:px-4 pb-1">
      {expanded ? (
        <div className="bg-meeting-card border border-meeting-border rounded-lg p-2 shadow-lg mb-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="flex items-center gap-1.5 text-[10px] text-gray-500 uppercase tracking-wide">
              <Clapperboard size={12} className="text-primary" />
              Broadcast Graphics
            </span>
            <button
              onClick={() => setExpanded(false)}
              className="p-1 rounded text-gray-400 hover:text-white shrink-0"
              aria-label="Close broadcast graphics settings"
            >
              <X size={14} />
            </button>
          </div>

          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {/* ---- Ticker ---- */}
            <section className="bg-meeting-bg border border-meeting-border rounded-md p-2">
              {sectionHeader(<Clapperboard size={11} />, 'Scrolling Ticker')}
              <div className="flex items-center justify-between mb-1.5">
                {toggleRow(t.enabled, (v) => update('ticker', { enabled: v }))}
                <select
                  value={t.position}
                  onChange={(e) => update('ticker', { position: e.target.value })}
                  className="bg-meeting-bg border border-meeting-border rounded px-1.5 py-1 text-[11px] text-gray-200 focus:outline-none focus:border-primary/50"
                >
                  {TICKER_POSITIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <textarea
                value={tickerItemsToText(t.items)}
                onChange={(e) => update('ticker', { items: textToTickerItems(e.target.value) })}
                placeholder={'One headline per line...\nBreaking: storm warning\nTraffic update'}
                rows={3}
                className="w-full bg-meeting-bg border border-meeting-border rounded px-2 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-primary/50 resize-y"
              />
              <div className="grid grid-cols-3 gap-2 mt-2">
                {numberField('Speed px/s', t.speed, 20, 600, (v) => update('ticker', { speed: v }))}
                {numberField('Height', t.height, 24, 160, (v) => update('ticker', { height: v }))}
                {numberField('Font size', t.fontSize, 12, 96, (v) => update('ticker', { fontSize: v }))}
              </div>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-gray-400">
                  <input
                    type="checkbox"
                    checked={t.uppercase}
                    onChange={(e) => update('ticker', { uppercase: e.target.checked })}
                    className="accent-primary"
                  />
                  UPPERCASE
                </label>
                {colorField('BG', t.bgColor, (v) => update('ticker', { bgColor: v }))}
                {colorField('Text', t.textColor, (v) => update('ticker', { textColor: v }))}
              </div>
            </section>

            {/* ---- Bug / logo ---- */}
            <section className="bg-meeting-bg border border-meeting-border rounded-md p-2">
              {sectionHeader(<ImageIcon size={11} />, 'Logo / Bug')}
              <div className="flex items-center justify-between mb-1.5">
                {toggleRow(b.enabled, (v) => update('bug', { enabled: v }))}
                {b.src && (
                  <button
                    onClick={() => update('bug', { src: '' })}
                    className="text-[10px] text-gray-500 hover:text-red-400 transition-colors"
                  >
                    Remove image
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => document.getElementById('broadcast-bug-file')?.click()}
                  disabled={logoBusy}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-meeting-card border border-meeting-border text-[11px] text-gray-300 hover:text-white disabled:opacity-50 transition-colors"
                >
                  <Upload size={12} />
                  {logoBusy ? 'Processingâ€¦' : 'Upload logo'}
                </button>
                <input
                  id="broadcast-bug-file"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    handleLogoFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <input
                  type="text"
                  value={/^data:/i.test(b.src) ? '' : b.src}
                  onChange={(e) => update('bug', { src: e.target.value.trim() })}
                  placeholder="â€¦or paste an image URL"
                  className="flex-1 min-w-0 bg-meeting-bg border border-meeting-border rounded px-2 py-1.5 text-xs text-gray-200 font-mono focus:outline-none focus:border-primary/50"
                />
              </div>
              {b.src && (
                <img
                  src={b.src}
                  alt="Logo preview"
                  className="mt-2 max-h-14 object-contain bg-meeting-card rounded border border-meeting-border"
                />
              )}
              <div className="grid grid-cols-3 gap-2 mt-2">
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wide">Position</span>
                  <select
                    value={b.position}
                    onChange={(e) => update('bug', { position: e.target.value })}
                    className="bg-meeting-bg border border-meeting-border rounded px-1.5 py-1 text-[11px] text-gray-200 focus:outline-none focus:border-primary/50"
                  >
                    {BUG_POSITIONS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </label>
                {numberField('Width px', b.width, 24, 900, (v) => update('bug', { width: v }))}
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wide">Opacity</span>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={b.opacity}
                    onChange={(e) => update('bug', { opacity: Number(e.target.value) })}
                    className="accent-primary mt-1.5"
                  />
                </label>
              </div>
            </section>

            {/* ---- Supers (SUPER/CG) ---- */}
            <section className="bg-meeting-bg border border-meeting-border rounded-md p-2">
              {sectionHeader(<Clapperboard size={11} />, 'Lower Thirds (SUPER / CG)')}
              <div className="flex items-center justify-between mb-1.5">
                {toggleRow(s.enabled, (v) => update('supers', { enabled: v }))}
                <select
                  value={s.position}
                  onChange={(e) => update('supers', { position: e.target.value })}
                  className="bg-meeting-bg border border-meeting-border rounded px-1.5 py-1 text-[11px] text-gray-200 focus:outline-none focus:border-primary/50"
                >
                  {SUPER_POSITIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                {s.items.map((item, index) => (
                  <div
                    key={item.id}
                    className={`rounded border p-1.5 ${
                      s.activeIndex === index
                        ? 'border-primary/60 bg-primary/10'
                        : 'border-meeting-border bg-meeting-card'
                    }`}
                  >
                    <div className="flex items-center gap-1 mb-1">
                      <button
                        onClick={() =>
                          update('supers', { activeIndex: s.activeIndex === index ? -1 : index })
                        }
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                          s.activeIndex === index
                            ? 'bg-red-600 hover:bg-red-700 text-white'
                            : 'bg-primary hover:bg-primary-dark text-white'
                        }`}
                        title={s.activeIndex === index ? 'Take off air' : 'Put on air'}
                      >
                        {s.activeIndex === index ? 'â— On Air' : 'On Air'}
                      </button>
                      <input
                        type="text"
                        value={item.name}
                        onChange={(e) => {
                          const items = s.items.map((it, i) =>
                            i === index ? { ...it, name: e.target.value } : it
                          );
                          update('supers', { items });
                        }}
                        placeholder="Name"
                        className="flex-1 min-w-0 bg-meeting-bg border border-meeting-border rounded px-1.5 py-1 text-xs text-gray-200 focus:outline-none focus:border-primary/50"
                      />
                      <button
                        onClick={() => {
                          const items = s.items.filter((_, i) => i !== index);
                          const activeIndex = s.activeIndex === index ? -1 : s.activeIndex;
                          update('supers', { items, activeIndex });
                        }}
                        className="p-1 rounded text-gray-500 hover:text-red-400 transition-colors shrink-0"
                        aria-label="Delete lower third"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={item.designation}
                        onChange={(e) => {
                          const items = s.items.map((it, i) =>
                            i === index ? { ...it, designation: e.target.value } : it
                          );
                          update('supers', { items });
                        }}
                        placeholder="Designation (e.g. Anchor, News Editor)"
                        className="flex-1 min-w-0 bg-meeting-bg border border-meeting-border rounded px-1.5 py-1 text-xs text-gray-400 focus:outline-none focus:border-primary/50"
                      />
                      <select
                        value={item.position || s.position}
                        onChange={(e) => {
                          const items = s.items.map((it, i) =>
                            i === index ? { ...it, position: e.target.value } : it
                          );
                          update('supers', { items });
                        }}
                        title="Position for this lower third (empty = use section default)"
                        className="bg-meeting-bg border border-meeting-border rounded px-1.5 py-1 text-[11px] text-gray-200 focus:outline-none focus:border-primary/50"
                      >
                        {SUPER_POSITIONS.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <input
                      type="text"
                      value={item.headline}
                      onChange={(e) => {
                        const items = s.items.map((it, i) =>
                          i === index ? { ...it, headline: e.target.value } : it
                        );
                        update('supers', { items });
                      }}
                      placeholder="Headline / lower-third text"
                      className="w-full mt-1 bg-meeting-bg border border-meeting-border rounded px-1.5 py-1 text-xs text-gray-200 focus:outline-none focus:border-primary/50"
                    />
                  </div>
                ))}
              </div>

              <button
                onClick={() =>
                  update('supers', {
                    items: [
                      ...s.items,
                      {
                        id: `super-${Date.now()}`,
                        name: '',
                        designation: '',
                        headline: '',
                        position: ''
                      }
                    ]
                  })
                }
                className="mt-2 flex items-center gap-1 px-2.5 py-1 rounded bg-meeting-card border border-meeting-border text-[11px] text-gray-300 hover:text-white transition-colors"
              >
                <Plus size={12} />
                Add lower third
              </button>

              <div className="grid grid-cols-2 gap-2 mt-2">
                {numberField('Font size', s.fontSize, 14, 120, (v) => update('supers', { fontSize: v }))}
                <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-gray-400 self-end pb-2">
                  <input
                    type="checkbox"
                    checked={s.uppercase}
                    onChange={(e) => update('supers', { uppercase: e.target.checked })}
                    className="accent-primary"
                  />
                  UPPERCASE
                </label>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {colorField('Panel', s.bgColor, (v) => update('supers', { bgColor: v }))}
                {colorField('Accent', s.accentColor, (v) => update('supers', { accentColor: v }))}
                {colorField('Name', s.textColor, (v) => update('supers', { textColor: v }))}
                {colorField('Headline', s.headlineColor, (v) => update('supers', { headlineColor: v }))}
              </div>
            </section>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setExpanded(true)}
          className="mb-2 flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 border transition-colors bg-meeting-card border-meeting-border text-gray-300 hover:text-white"
          title="Configure news-style overlay graphics (ticker, logo, lower thirds)"
        >
          <Clapperboard size={14} />
          Broadcast Graphics
        </button>
      )}
    </div>
  );
}
