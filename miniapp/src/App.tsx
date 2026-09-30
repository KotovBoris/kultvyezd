import { useEffect, useState } from "react";
import { api, type SchoolClass, type Excursion } from "./api";
import { deviceName, effectiveUserId, maxVersion, platform, startParam, isInsideMax } from "./max";
import { setSession, useSession } from "./store";
import ExcursionsScreen from "./screens/ExcursionsScreen";
import DashboardScreen from "./screens/DashboardScreen";
import ParentScreen from "./screens/ParentScreen";
import ClassesScreen from "./screens/ClassesScreen";
import WizardScreen from "./screens/WizardScreen";

type Tab = "trips" | "classes";

export default function App() {
  const session = useSession();
  const [tab, setTab] = useState<Tab>("trips");
  const [wizard, setWizard] = useState(false);
  const [excursions, setExcursions] = useState<Excursion[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const [exc, cls] = await Promise.all([api.excursions(), api.classes(session.userId)]);
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

  useEffect(() => {
    setSession({ userId: effectiveUserId() });
    const param = startParam();
    if (param && /^\d+$/.test(param)) {
      setSession({ role: "parent", studentId: Number(param) });
    }
  }, []);

  useEffect(() => {
    if (session.role === "teacher") reload();
  }, [session.role, session.userId]);

  if (session.role === "parent") {
    return (
      <div className="kv-app">
        <Header />
        <ParentScreen userId={session.userId} />
        <RoleSwitch />
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
        <button className={`kv-tab ${tab === "trips" ? "active" : ""}`} onClick={() => { setTab("trips"); setWizard(false); }}>
          Мероприятия
        </button>
        <button className={`kv-tab ${tab === "classes" ? "active" : ""}`} onClick={() => { setTab("classes"); setWizard(false); }}>
          Классы
        </button>
      </div>

      {loading && <SkeletonLoader />}

      {!loading && tab === "trips" && !wizard && (
        <>
          <div className="kv-card">
            <div className="kv-row">
              <h3>Мероприятия</h3>
              <button className="kv-btn primary" onClick={() => setWizard(true)}>
                Создать мероприятие
              </button>
            </div>
          </div>
          <ExcursionsScreen excursions={excursions} activeId={activeId} onSelect={setActiveId} />
          {activeId && <DashboardScreen excursionId={activeId} onChange={reload} />}
        </>
      )}

      {!loading && tab === "trips" && wizard && (
        <WizardScreen
          classes={classes}
          onCancel={() => setWizard(false)}
          onCreated={async (id) => {
            setWizard(false);
            await reload();
            setActiveId(id);
          }}
        />
      )}

      {!loading && tab === "classes" && (
        <ClassesScreen classes={classes} userId={session.userId} onChange={reload} />
      )}

      {!isInsideMax() && <DemoPanel onChange={reload} />}

      <RoleSwitch />
      <Footer />
    </div>
  );
}

function RoleSwitch() {
  const session = useSession();
  return (
    <div className="kv-card">
      <div className="kv-row">
        <span className="kv-muted">
          Режим: <b>{session.role === "parent" ? "родитель" : "учитель"}</b>
        </span>
        <button
          className="kv-btn ghost"
          onClick={() => setSession({ role: session.role === "parent" ? "teacher" : "parent" })}
        >
          {session.role === "parent" ? "Я учитель" : "Я родитель"}
        </button>
      </div>
    </div>
  );
}

function DemoPanel({ onChange }: { onChange: () => void }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function resetDemo() {
    try {
      const r = await api.resetDemo();
      setMsg(`Демо сброшено: ${r.reset_participants} участников переведены в «ожидает».`);
      onChange();
    } catch (e: any) {
      setMsg(`Ошибка сброса: ${e.message}`);
    }
  }

  return (
    <div className="kv-card kv-viewpanel">
      <div className="kv-row">
        <b>Режим просмотра (вне MAX)</b>
        <button className="kv-btn ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Свернуть" : "Развернуть"}
        </button>
      </div>
      {open && (
        <>
          <p className="kv-muted">
            Текущий пользователь: <b>{session.userId ?? "—"}</b>. Внутри MAX берётся настоящий
            id, в браузере — параметр адресной строки ?user_id=&lt;id&gt; либо случайный
            демо-идентификатор, сохранённый в этом браузере. Кнопка ниже возвращает статусы
            демо-выезда в «ожидает».
          </p>
          <div className="kv-actions">
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
        <p className="kv-title">ClassGo</p>
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
