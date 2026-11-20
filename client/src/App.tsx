import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import {
  Briefcase,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  LayoutDashboard,
  LayoutGrid,
  Layers,
  List,
  LoaderCircle,
  Mail,
  Menu,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import {
  Employee,
  EmployeeInput,
  createEmployee,
  deleteEmployee,
  errorMessage,
  getEmployees,
  updateEmployee,
} from './api';
import './App.css';

/* ---------- constants & helpers ---------- */

const LIMIT = 5;
const EMPTY: EmployeeInput = { name: '', email: '', role: '' };
const PALETTE = ['#6c4cf5', '#14b8a6', '#f59e0b', '#ec4899', '#3b82f6', '#22c55e'];

type Theme = 'light' | 'dark';
type View = 'table' | 'grid';
type Toast = { id: number; type: 'success' | 'error'; text: string };

const colorFor = (text: string) => {
  let h = 0;
  for (const c of text.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

const empCode = (id: number) => `EMP-${String(id).padStart(3, '0')}`;

const fmtDate = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';
};

const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

const tint = (color: string): CSSProperties => ({ '--c': color } as CSSProperties);

/* ---------- small presentational components ---------- */

function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span className={`avatar ${size}`} style={tint(colorFor(name))}>
      {initials(name)}
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  return (
    <span className="role-badge" style={tint(colorFor(role))}>
      {role}
    </span>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min;
  const y = (v: number) => (range === 0 ? 16 : 28 - ((v - min) / range) * 24);
  const line = data
    .map((v, i) => `${(i / (data.length - 1 || 1)) * 100},${y(v)}`)
    .join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,32 ${line} 100,32`} className="spark-area" />
      <polyline points={line} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Donut({ slices, total }: { slices: { label: string; value: number; color: string }[]; total: number }) {
  const R = 40;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg viewBox="0 0 100 100" className="donut" role="img" aria-label="Employees by role">
      <circle cx="50" cy="50" r={R} className="donut-track" />
      {slices.map((s) => {
        const len = total ? (s.value / total) * C : 0;
        const circle = (
          <circle
            key={s.label}
            cx="50"
            cy="50"
            r={R}
            stroke={s.color}
            strokeDasharray={`${Math.max(len - 1.5, 0)} ${C - Math.max(len - 1.5, 0)}`}
            strokeDashoffset={-offset}
            className="donut-seg"
          />
        );
        offset += len;
        return circle;
      })}
      <text x="50" y="49" textAnchor="middle" className="donut-num">{total}</text>
      <text x="50" y="62" textAnchor="middle" className="donut-lbl">people</text>
    </svg>
  );
}

function Kpi(props: {
  icon: React.ReactNode;
  color: string;
  label: string;
  value: React.ReactNode;
  foot: React.ReactNode;
  spark?: number[];
}) {
  return (
    <article className="kpi" style={tint(props.color)}>
      <div className="kpi-head">
        <span className="kpi-icon">{props.icon}</span>
        <span className="kpi-label">{props.label}</span>
      </div>
      <div className="kpi-body">
        <strong className="kpi-value">{props.value}</strong>
        {props.spark && <Sparkline data={props.spark} />}
      </div>
      <div className="kpi-foot">{props.foot}</div>
    </article>
  );
}

/* ---------- main component ---------- */

export default function App() {
  // directory data (paginated + searchable)
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  // analytics data (all records, unfiltered)
  const [all, setAll] = useState<Employee[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);

  // ui state
  const [view, setView] = useState<View>('table');
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<EmployeeInput>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  /* theme */
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  /* data loading */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getEmployees(page, LIMIT, query);
      setEmployees(res.data);
      setTotal(res.total);
      setFetchError('');
    } catch (e) {
      setFetchError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  const loadAll = useCallback(async () => {
    try {
      const res = await getEmployees(1, 50, '');
      setAll(res.data);
      setGrandTotal(res.total);
    } catch {
      /* the directory request already reports connection errors */
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAll(); }, [loadAll]);

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  /* toasts */
  const notify = (type: Toast['type'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, type, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  };

  /* drawer + modal */
  const openAdd = () => {
    setForm(EMPTY);
    setEditingId(null);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setForm({ name: emp.name, email: emp.email, role: emp.role });
    setEditingId(emp.id);
    setFormError('');
    setFormOpen(true);
  };

  const closeForm = () => setFormOpen(false);

  useEffect(() => {
    if (formOpen) {
      const t = setTimeout(() => nameRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [formOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setFormOpen(false);
      setDeleteTarget(null);
      setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* actions */
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (editingId !== null) {
        await updateEmployee(editingId, form);
        notify('success', `${form.name} was updated.`);
      } else {
        await createEmployee(form);
        notify('success', `${form.name} was added to the directory.`);
      }
      setFormOpen(false);
      if (editingId === null && page !== 1) setPage(1);
      else await load();
      loadAll();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteEmployee(deleteTarget.id);
      notify('success', `${deleteTarget.name} was removed.`);
      setDeleteTarget(null);
      if (employees.length === 1 && page > 1) setPage(page - 1);
      else await load();
      loadAll();
    } catch (err) {
      notify('error', errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const refresh = () => {
    load();
    loadAll();
  };

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMenuOpen(false);
  };

  const bind = (key: keyof EmployeeInput) => ({
    value: form[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
  });

  /* analytics */
  const stats = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { key: monthKey(d), label: d.toLocaleString('en', { month: 'short' }), start: d, count: 0 };
    });
    let before = 0;
    for (const emp of all) {
      const d = emp.created_at ? new Date(emp.created_at) : null;
      if (!d || Number.isNaN(d.getTime())) continue;
      const m = months.find((x) => x.key === monthKey(d));
      if (m) m.count += 1;
      else if (d < months[0].start) before += 1;
    }
    let running = before;
    const cumulative = months.map((m) => (running += m.count));

    const roleCount = new Map<string, number>();
    all.forEach((e) => roleCount.set(e.role, (roleCount.get(e.role) ?? 0) + 1));
    const sorted = [...roleCount.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((sum, [, n]) => sum + n, 0);
    const slices = top.map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }));
    if (rest) slices.push({ label: 'Other roles', value: rest, color: '#94a3b8' });

    const thisMonth = months[5].count;
    const lastMonth = months[4].count;
    return {
      months,
      cumulative,
      slices,
      roles: sorted.length,
      topRole: sorted[0]?.[0] ?? '—',
      thisMonth,
      lastMonth,
      maxMonth: Math.max(...months.map((m) => m.count), 1),
      sampleTotal: all.length,
      latest: all[0],
    };
  }, [all]);

  const firstRecord = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const lastRecord = Math.min(page * LIMIT, total);
  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
    const end = Math.min(totalPages, start + 4);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [page, totalPages]);

  const firstLoad = loading && employees.length === 0;
  const delta = stats.thisMonth - stats.lastMonth;

  /* ---------- render ---------- */
  return (
    <div className="shell">
      {/* Sidebar */}
      <div className={`scrim ${menuOpen ? 'show' : ''}`} onClick={() => setMenuOpen(false)} />
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark"><UsersRound size={22} /></span>
          <div>
            <strong>PeopleHub</strong>
            <small>Team management</small>
          </div>
        </div>

        <nav className="nav">
          <span className="nav-title">Main</span>
          <button className="nav-item" onClick={() => scrollTo('overview')}>
            <LayoutDashboard size={18} /> Overview
          </button>
          <button className="nav-item active" onClick={() => scrollTo('directory')}>
            <Users size={18} /> Employees
            <span className="nav-count">{grandTotal}</span>
          </button>
        </nav>

        <div className="side-card">
          <span className="side-card-icon"><UserPlus size={18} /></span>
          <strong>Growing the team?</strong>
          <p>Add a new employee in seconds.</p>
          <button className="side-card-btn" onClick={openAdd}>Add employee</button>
        </div>

        <div className="profile">
          <span className="profile-avatar">AD</span>
          <div>
            <strong>Administrator</strong>
            <small>Workspace admin</small>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="crumbs">Workspace <span>/</span> <strong>Employees</strong></div>
          <div className="topbar-right">
            <button
              className="icon-btn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
              title="Toggle light / dark"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button className="btn primary" onClick={openAdd}>
              <Plus size={17} /> Add employee
            </button>
          </div>
        </header>

        <main className="content">
          {/* Hero */}
          <section className="hero" id="overview">
            <div className="hero-text">
              <span className="hero-date">
                <CalendarDays size={15} />
                {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
              </span>
              <h1>{greeting()}, Admin</h1>
              <p>Here’s how your team looks today. Add people, update roles and keep the directory current.</p>
              <div className="hero-actions">
                <button className="btn light" onClick={openAdd}><Plus size={17} /> New employee</button>
                <button className="btn ghost" onClick={() => scrollTo('directory')}>Browse directory</button>
              </div>
            </div>
            <div className="hero-stats">
              <div className="hero-stat">
                <span className="hero-stat-icon"><Users size={18} /></span>
                <strong>{grandTotal}</strong>
                <small>Employees</small>
              </div>
              <div className="hero-stat">
                <span className="hero-stat-icon"><Layers size={18} /></span>
                <strong>{stats.roles}</strong>
                <small>Roles</small>
              </div>
              <div className="hero-stat">
                <span className="hero-stat-icon"><UserPlus size={18} /></span>
                <strong>{stats.thisMonth}</strong>
                <small>Joined this month</small>
              </div>
            </div>
          </section>

          {/* KPIs */}
          <section className="kpis">
            <Kpi
              icon={<Users size={19} />}
              color="#6c4cf5"
              label="Total employees"
              value={grandTotal}
              spark={grandTotal > 0 ? stats.cumulative : undefined}
              foot={<span className="pill up">+{stats.thisMonth} this month</span>}
            />
            <Kpi
              icon={<UserPlus size={19} />}
              color="#14b8a6"
              label="New this month"
              value={stats.thisMonth}
              foot={
                <span className={`pill ${delta >= 0 ? 'up' : 'down'}`}>
                  {delta >= 0 ? '+' : ''}{delta} vs last month
                </span>
              }
            />
            <Kpi
              icon={<Briefcase size={19} />}
              color="#f59e0b"
              label="Active roles"
              value={stats.roles}
              foot={<span className="muted-text">Most common: {stats.topRole}</span>}
            />
            <Kpi
              icon={<CalendarDays size={19} />}
              color="#ec4899"
              label="Latest hire"
              value={<span className="kpi-name">{stats.latest?.name ?? '—'}</span>}
              foot={<span className="muted-text">{stats.latest ? fmtDate(stats.latest.created_at) : 'No hires yet'}</span>}
            />
          </section>

          {/* Charts */}
          <section className="charts">
            <article className="card">
              <div className="card-head">
                <div>
                  <h2>Hiring activity</h2>
                  <p>New employees over the last 6 months</p>
                </div>
              </div>
              {grandTotal === 0 ? (
                <div className="chart-empty"><CalendarDays size={22} /><span>Add employees to see hiring trends.</span></div>
              ) : (
                <div className="bars">
                  {stats.months.map((m, i) => (
                    <div className={`bar-col ${i === 5 ? 'current' : ''}`} key={m.key}>
                      <span className="bar-tip">{m.count} hired</span>
                      <div className="bar-track">
                        <div className="bar" style={{ height: `${(m.count / stats.maxMonth) * 100}%` }} />
                      </div>
                      <span className="bar-label">{m.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="card">
              <div className="card-head">
                <div>
                  <h2>Team by role</h2>
                  <p>Distribution of job roles</p>
                </div>
              </div>
              {grandTotal === 0 ? (
                <div className="chart-empty"><Layers size={22} /><span>No roles to show yet.</span></div>
              ) : (
                <div className="donut-wrap">
                  <Donut slices={stats.slices} total={stats.sampleTotal} />
                  <ul className="legend">
                    {stats.slices.map((s) => (
                      <li key={s.label}>
                        <span className="dot" style={{ background: s.color }} />
                        <span className="legend-label">{s.label}</span>
                        <strong>{Math.round((s.value / stats.sampleTotal) * 100)}%</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          </section>

          {/* Directory */}
          <section className="card directory" id="directory">
            <div className="card-head">
              <div>
                <h2>Employee directory</h2>
                <p>Search, edit and manage every team member.</p>
              </div>
              <button className="icon-btn" onClick={refresh} disabled={loading} aria-label="Refresh" title="Refresh">
                <RefreshCw size={17} className={loading ? 'spin' : ''} />
              </button>
            </div>

            {fetchError && (
              <div className="banner error" role="alert">
                <TriangleAlert size={18} />
                <span>{fetchError}</span>
                <button className="link-btn" onClick={refresh}>Try again</button>
              </div>
            )}

            <div className="toolbar">
              <div className="search">
                <Search size={17} />
                <input
                  type="search"
                  placeholder="Search by name…"
                  aria-label="Search employees by name"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button onClick={() => setSearch('')} aria-label="Clear search">
                    <X size={15} />
                  </button>
                )}
              </div>

              <div className="toolbar-right">
                <span className="count">{total} {total === 1 ? 'result' : 'results'}</span>
                <div className="segmented" role="group" aria-label="Change view">
                  <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')} aria-label="Table view">
                    <List size={16} />
                  </button>
                  <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')} aria-label="Grid view">
                    <LayoutGrid size={16} />
                  </button>
                </div>
              </div>
            </div>

            <div className={`results ${loading && !firstLoad ? 'dim' : ''}`}>
              {firstLoad ? (
                <div className="skeletons">
                  {Array.from({ length: LIMIT }, (_, i) => <div className="skeleton" key={i} />)}
                </div>
              ) : employees.length === 0 ? (
                <div className="empty">
                  <span className="empty-icon"><Users size={28} /></span>
                  <strong>{query ? 'No matching employees' : 'No employees yet'}</strong>
                  <p>{query ? `Nothing matches “${query}”. Try a different name.` : 'Add your first team member to get started.'}</p>
                  {!query && <button className="btn primary" onClick={openAdd}><Plus size={17} /> Add employee</button>}
                </div>
              ) : view === 'table' ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Joined</th>
                        <th className="right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((emp) => (
                        <tr key={emp.id}>
                          <td>
                            <div className="person">
                              <Avatar name={emp.name} />
                              <div>
                                <strong>{emp.name}</strong>
                                <small>{empCode(emp.id)}</small>
                              </div>
                            </div>
                          </td>
                          <td className="muted-text">{emp.email}</td>
                          <td><RoleBadge role={emp.role} /></td>
                          <td className="muted-text nowrap">{fmtDate(emp.created_at)}</td>
                          <td>
                            <div className="row-actions">
                              <button className="icon-btn sm" onClick={() => openEdit(emp)} aria-label={`Edit ${emp.name}`} title="Edit">
                                <Pencil size={15} />
                              </button>
                              <button className="icon-btn sm danger" onClick={() => setDeleteTarget(emp)} aria-label={`Delete ${emp.name}`} title="Delete">
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="grid">
                  {employees.map((emp) => (
                    <article className="person-card" key={emp.id} style={tint(colorFor(emp.role))}>
                      <Avatar name={emp.name} size="lg" />
                      <strong>{emp.name}</strong>
                      <RoleBadge role={emp.role} />
                      <span className="person-mail"><Mail size={14} /> {emp.email}</span>
                      <span className="person-date"><CalendarDays size={14} /> Joined {fmtDate(emp.created_at)}</span>
                      <div className="card-actions">
                        <button className="btn soft" onClick={() => openEdit(emp)}><Pencil size={15} /> Edit</button>
                        <button className="icon-btn danger" onClick={() => setDeleteTarget(emp)} aria-label={`Delete ${emp.name}`}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="pager">
              <span>
                Showing <strong>{firstRecord}–{lastRecord}</strong> of <strong>{total}</strong>
              </span>
              <div className="pager-controls">
                <button className="page-btn" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} aria-label="Previous page">
                  <ChevronLeft size={17} />
                </button>
                {pageNumbers.map((n) => (
                  <button
                    key={n}
                    className={`page-btn ${n === page ? 'on' : ''}`}
                    onClick={() => setPage(n)}
                    disabled={loading}
                    aria-current={n === page ? 'page' : undefined}
                  >
                    {n}
                  </button>
                ))}
                <button className="page-btn" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)} aria-label="Next page">
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
          </section>

          <footer className="footer">
            <span>© {new Date().getFullYear()} PeopleHub · Employee Directory</span>
          </footer>
        </main>
      </div>

      {/* Add / edit form */}
      {formOpen && (
        <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && closeForm()}>
          <div className="modal form-modal" role="dialog" aria-modal="true" aria-label="Employee form">
            <div className="form-head">
              <Avatar name={form.name || '?'} />
              <div>
                <h2>{editingId !== null ? 'Edit employee' : 'Add employee'}</h2>
                <p>{editingId !== null ? 'Update the details below.' : 'Enter the new team member’s details.'}</p>
              </div>
              <button className="icon-btn sm" onClick={closeForm} aria-label="Close form"><X size={17} /></button>
            </div>

            <form onSubmit={onSubmit} className="modal-form">
              {formError && (
                <div className="banner error" role="alert">
                  <TriangleAlert size={18} /> <span>{formError}</span>
                </div>
              )}

              <label>
                Full name
                <div className="field">
                  <Users size={16} />
                  <input ref={nameRef} required maxLength={100} placeholder="e.g. Asha Patel" {...bind('name')} />
                </div>
              </label>
              <label>
                Email address
                <div className="field">
                  <Mail size={16} />
                  <input required type="email" maxLength={150} placeholder="name@company.com" {...bind('email')} />
                </div>
              </label>
              <label>
                Job role
                <div className="field">
                  <Briefcase size={16} />
                  <input required maxLength={100} placeholder="e.g. Backend Engineer" {...bind('role')} />
                </div>
              </label>

              <div className="form-actions">
                <button type="button" className="btn outline" onClick={closeForm} disabled={saving}>Cancel</button>
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? <LoaderCircle size={16} className="spin" /> : editingId !== null ? <Pencil size={15} /> : <Plus size={16} />}
                  {saving ? 'Saving…' : editingId !== null ? 'Save changes' : 'Create employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="modal-wrap" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="modal" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <span className="modal-icon"><Trash2 size={24} /></span>
            <h3>Delete {deleteTarget.name}?</h3>
            <p>This permanently removes the employee record. You can’t undo this action.</p>
            <div className="modal-actions">
              <button className="btn outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Keep employee</button>
              <button className="btn danger" onClick={confirmDelete} disabled={deleting}>
                {deleting && <LoaderCircle size={16} className="spin" />}
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div className={`toast ${t.type}`} key={t.id}>
            {t.type === 'success' ? <CircleCheck size={19} /> : <TriangleAlert size={19} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
