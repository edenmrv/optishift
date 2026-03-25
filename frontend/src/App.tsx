import React, { useMemo, useState, useRef } from 'react';
import html2canvas from 'html2canvas';
import { buildSchedule, type Soldier, type ScheduleConfig, type ScheduleEntry, type SoldierStats, type ScheduleResult, type FixedEntry, type DayStatus } from './solver';

const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function formatDateHebrew(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const dayName = dayNames[d.getDay()];
  return `${dayName} ${dateStr.slice(8)}/${dateStr.slice(5, 7)}`;
}

const statusDisplay: Record<DayStatus, { label: string; bg: string; color: string }> = {
  home:      { label: 'בבית',        bg: '#252832',                    color: '#64748b' },
  arriving:  { label: 'בדרך לבסיס',  bg: 'rgba(59,130,246,0.3)',       color: '#93c5fd' },
  base:      { label: 'בבסיס',       bg: 'rgba(16,185,129,0.3)',       color: '#6ee7b7' },
  departing: { label: 'יוצא הביתה',  bg: 'rgba(251,191,36,0.25)',      color: '#fcd34d' },
  blocked:   { label: 'אילוץ',       bg: '#7c3aed33',                  color: '#c4b5fd' },
};

function getCellDisplay(entry: ScheduleEntry | undefined) {
  if (!entry) return statusDisplay.home;
  return statusDisplay[entry.status];
}

interface ManualOverride { soldierId: string; date: string; status: 'base' | 'home'; }

const App: React.FC = () => {
  const today = new Date();
  const twoWeeks = new Date(today.getTime() + 13 * 86400000);

  const [config, setConfig] = useState<ScheduleConfig>({
    startDate: today.toISOString().slice(0, 10),
    endDate: twoWeeks.toISOString().slice(0, 10),
    minSoldiersOnBase: 2,
    maxConsecutiveHomeDays: 4,
    minConsecutiveBaseDays: 2,
  });

  const [soldiers, setSoldiers] = useState<Soldier[]>([]);
  const [newName, setNewName] = useState('');
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<ManualOverride[]>([]);
  const [ovSoldier, setOvSoldier] = useState('');
  const [ovDate, setOvDate] = useState('');
  const [ovStatus, setOvStatus] = useState<'base' | 'home'>('base');
  const [blockedInput, setBlockedInput] = useState<{ id: string; date: string }>({ id: '', date: '' });
  const [expandedSoldier, setExpandedSoldier] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const dates = useMemo(() => {
    const out: string[] = [];
    const s = new Date(config.startDate + 'T00:00:00');
    const e = new Date(config.endDate + 'T00:00:00');
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(d.toISOString().slice(0, 10));
    return out;
  }, [config.startDate, config.endDate]);

  const entriesByKey = useMemo(() => {
    const m = new Map<string, ScheduleEntry>();
    if (result) for (const e of result.entries) m.set(`${e.date}|${e.soldierId}`, e);
    return m;
  }, [result]);

  const statsBySoldierId = useMemo(() => {
    const m = new Map<string, SoldierStats>();
    if (result) for (const s of result.stats) m.set(s.soldierId, s);
    return m;
  }, [result]);

  const baseCountByDate = useMemo(() => {
    const m = new Map<string, number>();
    if (!result) return m;
    for (const dt of dates) {
      let c = 0;
      for (const s of soldiers) {
        const e = entriesByKey.get(`${dt}|${s.id}`);
        if (e && e.status !== 'home' && e.status !== 'blocked') c++;
      }
      m.set(dt, c);
    }
    return m;
  }, [result, dates, soldiers, entriesByKey]);

  function handleGenerate() {
    if (soldiers.length === 0) { setError('הוסף לפחות חייל אחד.'); return; }
    if (config.minSoldiersOnBase > soldiers.length) { setError('מספר חיילים מינימלי בבסיס גדול ממספר החיילים.'); return; }
    setError(null);
    try {
      const fixed: FixedEntry[] = overrides.map(o => ({ soldierId: o.soldierId, date: o.date, status: o.status }));
      const r = buildSchedule(soldiers, config, fixed);
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'שגיאה ביצירת הלוח.');
    }
  }

  function addSoldier() {
    const name = newName.trim();
    if (!name) return;
    setSoldiers(p => [...p, { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, name, blockedDates: [] }]);
    setNewName('');
  }

  function removeSoldier(id: string) {
    setSoldiers(p => p.filter(s => s.id !== id));
    setOverrides(p => p.filter(o => o.soldierId !== id));
    setResult(null);
  }

  function addBlocked(sid: string, dt: string) {
    if (!dt) return;
    setSoldiers(p => p.map(s => s.id === sid && !s.blockedDates.includes(dt) ? { ...s, blockedDates: [...s.blockedDates, dt].sort() } : s));
    setBlockedInput({ id: '', date: '' });
  }

  function removeBlocked(sid: string, dt: string) {
    setSoldiers(p => p.map(s => s.id === sid ? { ...s, blockedDates: s.blockedDates.filter(d => d !== dt) } : s));
  }

  function addOverride() {
    if (!ovSoldier || !ovDate) return;
    setOverrides(p => {
      const rest = p.filter(o => !(o.date === ovDate && o.soldierId === ovSoldier));
      return [...rest, { soldierId: ovSoldier, date: ovDate, status: ovStatus }];
    });
    setOvDate('');
  }

  async function exportImage() {
    if (!tableRef.current) return;
    try {
      const canvas = await html2canvas(tableRef.current, { backgroundColor: '#1a1d27', scale: 2 });
      const a = document.createElement('a');
      a.download = `optishift-${config.startDate}_${config.endDate}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    } catch { setError('שגיאה בייצוא.'); }
  }

  // ── Styles ──
  const inp: React.CSSProperties = { width: '100%', marginTop: 4, background: '#252832', border: '1px solid #2d3140', color: 'inherit', padding: '6px 8px', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' };
  const btn: React.CSSProperties = { background: '#10b981', color: '#000', border: 'none', padding: '6px 14px', cursor: 'pointer', borderRadius: 4, fontWeight: 600, fontSize: 13 };
  const btnGhost: React.CSSProperties = { ...btn, background: '#374151', color: '#e2e8f0' };

  return (
    <div style={{ minHeight: '100vh', background: '#0f1117', color: '#f1f5f9', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <header style={{ padding: '14px 24px', borderBottom: '1px solid #2d3140', background: '#1a1d27', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24, fontWeight: 800, color: '#10b981' }}>OptiShift</span>
        </div>
        <span style={{ fontSize: 13, color: '#64748b' }}>ניהול תורנויות חכם למילואים</span>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <aside style={{ width: 380, minWidth: 380, borderLeft: '1px solid #2d3140', background: '#1a1d27', padding: 16, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>

          {/* Step 1 - Dates */}
          <section>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: '#10b981', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ background: '#10b981', color: '#000', borderRadius: 99, width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>1</span>
              טווח תאריכים
            </h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ flex: 1, fontSize: 12, color: '#94a3b8' }}>מתאריך<input type="date" value={config.startDate} onChange={e => setConfig(c => ({ ...c, startDate: e.target.value }))} style={inp} /></label>
              <label style={{ flex: 1, fontSize: 12, color: '#94a3b8' }}>עד תאריך<input type="date" value={config.endDate} onChange={e => setConfig(c => ({ ...c, endDate: e.target.value }))} style={inp} /></label>
            </div>
          </section>

          {/* Step 2 - Soldiers */}
          <section>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: '#10b981', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ background: '#10b981', color: '#000', borderRadius: 99, width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>2</span>
              חיילים ואילוצים
            </h2>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input placeholder="שם חייל" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSoldier()} style={{ ...inp, flex: 1, marginTop: 0 }} />
              <button onClick={addSoldier} style={btn}>הוסף</button>
            </div>
            <div style={{ maxHeight: 'calc(100vh - 500px)', minHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {soldiers.map(s => {
                const isOpen = expandedSoldier === s.id;
                return (
                  <div key={s.id} style={{ background: '#252832', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', cursor: 'pointer' }} onClick={() => setExpandedSoldier(isOpen ? null : s.id)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</span>
                        {s.blockedDates.length > 0 && <span style={{ fontSize: 10, color: '#c4b5fd', background: '#7c3aed33', padding: '1px 6px', borderRadius: 99 }}>{s.blockedDates.length} אילוצים</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: '#64748b' }}>{isOpen ? '▲' : '▼'}</span>
                        <button onClick={e => { e.stopPropagation(); removeSoldier(s.id); }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 11 }}>הסר</button>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ padding: '0 10px 10px', fontSize: 12 }}>
                        <div style={{ color: '#94a3b8', marginBottom: 4 }}>ימים שחייב להיות בבית (אילוצים):</div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input type="date" value={blockedInput.id === s.id ? blockedInput.date : ''} onChange={e => setBlockedInput({ id: s.id, date: e.target.value })} style={{ ...inp, flex: 1, marginTop: 0 }} />
                          <button onClick={() => addBlocked(s.id, blockedInput.date)} style={{ ...btn, padding: '4px 10px' }}>+</button>
                        </div>
                        {s.blockedDates.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                            {s.blockedDates.map(d => (
                              <span key={d} style={{ background: '#7c3aed22', color: '#c4b5fd', padding: '2px 8px', borderRadius: 4, fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                                {formatDateHebrew(d)}
                                <button onClick={() => removeBlocked(s.id, d)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 11, padding: 0 }}>x</button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {soldiers.length === 0 && <div style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: 16 }}>הוסף חיילים כדי להתחיל</div>}
            </div>
          </section>

          {/* Step 3 - Rules */}
          <section>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: '#10b981', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ background: '#10b981', color: '#000', borderRadius: 99, width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>3</span>
              כללים
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              <label style={{ color: '#94a3b8' }}>מינימום חיילים בבסיס בכל יום<input type="number" min={1} value={config.minSoldiersOnBase} onChange={e => setConfig(c => ({ ...c, minSoldiersOnBase: Math.max(1, +e.target.value || 1) }))} style={inp} /></label>
              <label style={{ color: '#94a3b8' }}>מקסימום ימי בית ברצף<input type="number" min={1} value={config.maxConsecutiveHomeDays} onChange={e => setConfig(c => ({ ...c, maxConsecutiveHomeDays: Math.max(1, +e.target.value || 1) }))} style={inp} /></label>
              <label style={{ color: '#94a3b8' }}>מינימום ימי בסיס ברצף (לא כולל נסיעות)<input type="number" min={1} value={config.minConsecutiveBaseDays} onChange={e => setConfig(c => ({ ...c, minConsecutiveBaseDays: Math.max(1, +e.target.value || 1) }))} style={inp} /></label>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                רצף מלא = בדרך לבסיס + {config.minConsecutiveBaseDays} ימי בסיס + יוצא הביתה = {config.minConsecutiveBaseDays + 2} ימים
              </div>
            </div>
          </section>

          {/* Manual overrides */}
          <details style={{ fontSize: 13 }}>
            <summary style={{ color: '#64748b', cursor: 'pointer', marginBottom: 8 }}>הזנות ידניות (אופציונלי)</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <select value={ovSoldier} onChange={e => setOvSoldier(e.target.value)} style={inp}>
                <option value="">בחר חייל</option>
                {soldiers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <input type="date" value={ovDate} onChange={e => setOvDate(e.target.value)} style={inp} />
              <select value={ovStatus} onChange={e => setOvStatus(e.target.value as 'base' | 'home')} style={inp}>
                <option value="base">בבסיס</option>
                <option value="home">בבית</option>
              </select>
              <button onClick={addOverride} style={btnGhost}>הוסף הזנה ידנית</button>
              {overrides.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {overrides.map((o, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', background: '#1a1d27', padding: '4px 8px', borderRadius: 4, fontSize: 11, color: '#94a3b8' }}>
                      <span>{soldiers.find(s => s.id === o.soldierId)?.name} | {o.date} | {o.status === 'base' ? 'בסיס' : 'בית'}</span>
                      <button onClick={() => setOverrides(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>x</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>

          {/* Generate */}
          <button onClick={handleGenerate} style={{ marginTop: 'auto', background: '#10b981', color: '#000', border: 'none', padding: '14px', fontWeight: 800, fontSize: 16, cursor: 'pointer', borderRadius: 8, letterSpacing: 0.5 }}>
            הכן לוח זמנים
          </button>
          {error && <div style={{ fontSize: 13, color: '#ef4444', background: '#ef444415', padding: 8, borderRadius: 6, marginTop: 4 }}>{error}</div>}
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, padding: 20, overflow: 'auto' }}>
          {result ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700 }}>לוח שיבוצים</h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {/* Legend */}
                  <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#94a3b8' }}>
                    {(['arriving', 'base', 'departing', 'blocked', 'home'] as DayStatus[]).map(s => (
                      <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: statusDisplay[s].bg, border: s === 'home' ? '1px solid #2d3140' : undefined, display: 'inline-block' }} />
                        {statusDisplay[s].label}
                      </span>
                    ))}
                  </div>
                  <button onClick={exportImage} style={btn}>שמור כתמונה</button>
                </div>
              </div>

              <div ref={tableRef} style={{ overflow: 'auto', border: '1px solid #2d3140', background: '#1a1d27', borderRadius: 8, padding: 2 }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#252832' }}>
                      <th style={{ padding: '8px 10px', border: '1px solid #2d3140', position: 'sticky', right: 0, background: '#252832', zIndex: 2, textAlign: 'right' }}>תאריך</th>
                      {soldiers.map(s => <th key={s.id} style={{ padding: '8px 10px', border: '1px solid #2d3140', whiteSpace: 'nowrap' }}>{s.name}</th>)}
                      <th style={{ padding: '8px 10px', border: '1px solid #2d3140', whiteSpace: 'nowrap', fontSize: 11 }}>בבסיס</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dates.map(dt => {
                      const cnt = baseCountByDate.get(dt) ?? 0;
                      const dayOfWeek = new Date(dt + 'T00:00:00').getDay();
                      const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
                      return (
                        <tr key={dt}>
                          <td style={{ padding: '5px 10px', whiteSpace: 'nowrap', background: isWeekend ? '#1e2040' : '#252832', border: '1px solid #2d3140', position: 'sticky', right: 0, zIndex: 1, fontSize: 11, fontWeight: 600 }}>
                            {formatDateHebrew(dt)}
                          </td>
                          {soldiers.map(s => {
                            const e = entriesByKey.get(`${dt}|${s.id}`);
                            const { label, bg, color } = getCellDisplay(e);
                            return <td key={s.id} style={{ padding: '5px 6px', textAlign: 'center', background: bg, border: '1px solid #2d3140', color, fontSize: 11, fontWeight: 500 }}>{label}</td>;
                          })}
                          <td style={{ padding: '5px 8px', textAlign: 'center', border: '1px solid #2d3140', fontWeight: 700, fontSize: 13, color: cnt < config.minSoldiersOnBase ? '#ef4444' : '#10b981' }}>{cnt}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Stats cards */}
              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                {soldiers.map(s => {
                  const st = statsBySoldierId.get(s.id);
                  return (
                    <div key={s.id} style={{ background: '#1a1d27', border: '1px solid #2d3140', padding: 12, borderRadius: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{s.name}</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#10b981' }}>{st?.totalBaseDays ?? 0} <span style={{ fontSize: 12, fontWeight: 400, color: '#64748b' }}>ימי שירות</span></div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{st?.totalHomeDays ?? 0} ימי בית{(st?.totalBlockedDays ?? 0) > 0 ? ` | ${st?.totalBlockedDays} אילוצים` : ''}</div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#475569', gap: 8 }}>
              <div style={{ fontSize: 48, opacity: 0.15, fontWeight: 800 }}>OptiShift</div>
              <div style={{ fontSize: 15 }}>הגדר תאריכים, הוסף חיילים ואילוצים</div>
              <div style={{ fontSize: 13, color: '#334155' }}>ולחץ "הכן לוח זמנים"</div>
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer style={{ padding: '8px 24px', borderTop: '1px solid #2d3140', background: '#1a1d27', fontSize: 11, color: '#334155', textAlign: 'center' }}>
        OptiShift — נבנה מהשטח, למפקדים בשטח
      </footer>
    </div>
  );
};

export default App;
