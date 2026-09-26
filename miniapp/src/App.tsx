import { useEffect, useState } from "react";
import { api, type SchoolClass, type Excursion } from "./api";
import { currentUserId, deviceName, maxVersion, platform, startParam, isInsideMax } from "./max";
import { setSession, useSession } from "./store";
import ExcursionsScreen from "./screens/ExcursionsScreen";
import CatalogScreen from "./screens/CatalogScreen";
import DashboardScreen from "./screens/DashboardScreen";
import ParentScreen from "./screens/ParentScreen";

type Tab = "trips" | "catalog";

export default function App() {
  const session = useSession();
  const [tab, setTab] = useState<Tab>("trips");
  const [excursions, setExcursions] = useState<Excursion[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const [exc, cls] = await Promise.all([api.excursions(), api.classes()]);
      setExcursions(exc);
      setClasses(cls);
      setActiveId((prev) => prev ?? exc[0]?.id ?? null);
      setError(null);
    } catch (e: any) {
      setError(`Не удалось загрузить данные: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  // Автоопределение роли: если открыт контекст родителя или MAX-профиль привязан к ребёнку.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1) явный контекст из ссылки ?startapp=<student_id>
      const param = startParam();
      if (param && /^\d+$/.test(param)) {
        setSession({ role: "parent", studentId: Number(param) });
        return;
      }
      // 2) MAX-профиль: ищем привязку по user_id (реалистичный сценарий MAX)
      const uid = currentUserId();
      if (uid) {
        try {
          const ctx = await api.parentContext(uid);
          if (!cancelled && ctx.found && ctx.children.length) {
            const child = ctx.children[0];
            setSession({
              role: "parent",
              studentId: child.student_id,
              resolvedStudentId: child.student_id,
              resolvedStudentName: child.student_name,
            });
          }
        } catch {
          /* не привязан — остаёмся в роли учителя */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    reload();
  }, []);

  // Экран родителя (по контексту или по привязке MAX-профиля)
  if (session.role === "parent" && session.studentId) {
    return (
      <div className="kv-app">
        <Header />
        <ParentScreen
          studentId={session.studentId}
          studentName={session.resolvedStudentName ?? undefined}
          excursions={excursions}
        />
        <Footer />
      </div>
    );
  }

  return (
    <div className="kv-app">
      <Header />
      {error && (
        <div className="kv-alert err">
          {error}
          <button className="kv-btn ghost" style={{ marginLeft: 8 }} onClick={reload}>
            Повторить
          </button>
        </div>
      )}
      <div className="kv-tabs">
        <button className={`kv-tab ${tab === "trips" ? "active" : ""}`} onClick={() => setTab("trips")}>
          Выезды класса
        </button>
        <button className={`kv-tab ${tab === "catalog" ? "active" : ""}`} onClick={() => setTab("catalog")}>
          Каталог событий
        </button>
      </div>

      {loading && <SkeletonLoader />}

      {!loading && tab === "trips" && (
        <>
          <ExcursionsScreen excursions={excursions} activeId={activeId} onSelect={setActiveId} />
          {activeId && <DashboardScreen excursionId={activeId} onChange={reload} />}
        </>
      )}

      {!loading && tab === "catalog" && (
        <CatalogScreen
          classes={classes}
          onCreated={async (id) => {
            await reload();
            setActiveId(id);
            setTab("trips");
          }}
        />
      )}

      {!isInsideMax() && (
        <ViewPanel
          classes={classes}
          onChange={reload}
          onOpenParent={(studentId, studentName) =>
            setSession({ role: "parent", studentId, resolvedStudentId: studentId, resolvedStudentName: studentName })
          }
        />
      )}

      <Footer />
    </div>
  );
}

/** Панель просмотра для ручной проверки вне мессенджера MAX. */
function ViewPanel({
  classes,
  onChange,
  onOpenParent,
}: {
  classes: SchoolClass[];
  onChange: () => void;
  onOpenParent: (studentId: number, studentName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const students = classes.flatMap((c) => c.students.map((s) => ({ ...s, klass: c.title })));
  const [msg, setMsg] = useState<string | null>(null);

  async function resetDemo() {
    try {
      const r = await api.resetDemo();
      setMsg(`Демо сброшено: ${r.reset_participants} участников → «ожидает».`);
      onChange();
    } catch (e: any) {
      setMsg(`Ошибка сброса: ${e.message}`);
    }
  }

  return (
    <div className="kv-card kv-viewpanel">
      <div className="kv-row">
        <b>🔎 Режим просмотра (вне MAX)</b>
        <button className="kv-btn ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Свернуть" : "Развернуть"}
        </button>
      </div>
      {open && (
        <>
          <p className="kv-muted">
            Ручная проверка без мессенджера: выберите родителя, чтобы открыть его экран,
            и сбросьте демо для повторного прогона сценария.
          </p>
          <div className="kv-filters">
            <select
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                const s = students.find((x) => String(x.id) === e.target.value);
                if (s) onOpenParent(s.id, s.full_name);
              }}
            >
              <option value="">Открыть экран родителя…</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name} ({s.klass})
                </option>
              ))}
            </select>
            <button className="kv-btn" onClick={resetDemo}>
              Сбросить демо-данные
            </button>
          </div>
          {msg && <div className="kv-alert info">{msg}</div>}
        </>
      )}
    </div>
  );
}

function SkeletonLoader() {
  return (
    <>
      <div className="kv-card kv-skeleton">
        <div className="kv-skel-line w60" />
        <div className="kv-skel-line w90" />
        <div className="kv-skel-line w80" />
        <div className="kv-skel-bar" />
      </div>
      <div className="kv-card kv-skeleton">
        <div className="kv-skel-line w40" />
        <div className="kv-skel-line w90" />
      </div>
    </>
  );
}

function Header() {
  return (
    <div className="kv-header">
      <div className="kv-logo">КВ</div>
      <div>
        <p className="kv-title">КультВыезд</p>
        <p className="kv-subtitle">Организация школьных культурных выездов в MAX</p>
      </div>
    </div>
  );
}

function Footer() {
  const inside = isInsideMax();
  return (
    <div className="kv-footer-note">
      Платформа: <b>{platform()}</b> · устройство: <b>{deviceName()}</b> · MAX: <b>{maxVersion()}</b>
      {!inside && <> · запущено вне MAX (веб-проверка)</>}
      {startParam() && <> · контекст: <b>{startParam()}</b></>}
      <br />
      Данные каталога — модельные (снапшот PRO.Культура.РФ / «Пушкинская карта», г. Казань).
      Оплата билетов происходит напрямую на сайте учреждения культуры.
    </div>
  );
}
