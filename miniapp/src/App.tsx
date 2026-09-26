import { useEffect, useState } from "react";
import { api, type SchoolClass, type Excursion } from "./api";
import { deviceName, maxVersion, platform, startParam, isInsideMax } from "./max";
import { useSession } from "./store";
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

  useEffect(() => {
    reload();
  }, []);

  // Экран родителя (по контексту запуска из бота)
  if (session.role === "parent" && session.studentId) {
    return (
      <div className="kv-app">
        <Header />
        <ParentScreen studentId={session.studentId} excursions={excursions} />
      </div>
    );
  }

  return (
    <div className="kv-app">
      <Header />
      {error && <div className="kv-alert err">{error}</div>}
      <div className="kv-tabs">
        <div className={`kv-tab ${tab === "trips" ? "active" : ""}`} onClick={() => setTab("trips")}>
          Выезды класса
        </div>
        <div className={`kv-tab ${tab === "catalog" ? "active" : ""}`} onClick={() => setTab("catalog")}>
          Каталог событий
        </div>
      </div>

      {loading && <div className="kv-card">Загрузка…</div>}

      {!loading && tab === "trips" && (
        <>
          <ExcursionsScreen
            excursions={excursions}
            activeId={activeId}
            onSelect={setActiveId}
          />
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

      <Footer />
    </div>
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
