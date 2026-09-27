import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { api, type SchoolClass, type Excursion, type ParentChild } from "./api";
import { currentUserId, deviceName, maxVersion, platform, startParam, isInsideMax } from "./max";
import { setSession, useSession } from "./store";
import SkeletonLoader from "./components/Skeleton";

/**
 * Экраны грузим лениво: на старте нужен только «Выезды класса» (дашборд),
 * а каталог, импорт класса и справка о данных — отдельными чанками. Так
 * начальный JS меньше, а код экрана, который учитель не открывает, не скачивается.
 * SkeletonLoader уже используется как статус загрузки данных — он же закрывает
 * паузу на подгрузку чанка, поэтому экран не «мигает» пустотой.
 */
const ExcursionsScreen = lazy(() => import("./screens/ExcursionsScreen"));
const CatalogScreen = lazy(() => import("./screens/CatalogScreen"));
const DashboardScreen = lazy(() => import("./screens/DashboardScreen"));
const ParentScreen = lazy(() => import("./screens/ParentScreen"));
const ImportScreen = lazy(() => import("./screens/ImportScreen"));
const TransparencyScreen = lazy(() => import("./screens/TransparencyScreen"));

type Tab = "trips" | "catalog" | "class";

export default function App() {
  const session = useSession();
  const [tab, setTab] = useState<Tab>("trips");
  // Экран-справка о данных и согласии — доступен из футера (доверие/безопасность).
  const [transparency, setTransparency] = useState(false);
  const [excursions, setExcursions] = useState<Excursion[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  // Все дети родителя (BUG: раньше брался только children[0]).
  const [children, setChildren] = useState<ParentChild[]>([]);
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

  // Роль: контекст ссылки ?startapp=<student_id> либо привязка MAX-профиля.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const param = startParam();
      if (param && /^\d+$/.test(param)) {
        setSession({ role: "parent", studentId: Number(param) });
        return;
      }
      const uid = currentUserId();
      if (uid) {
        try {
          const ctx = await api.parentContext(uid);
          if (!cancelled && ctx.found && ctx.children.length) {
            // Храним всех детей: экран родителя даёт переключатель, если их несколько.
            setChildren(ctx.children);
            const child = ctx.children[0];
            setSession({
              role: "parent",
              studentId: child.student_id,
              resolvedStudentId: child.student_id,
              resolvedStudentName: child.student_name,
            });
          }
        } catch {
          /* не привязан — остаёмся учителем */
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

  const isParent = Boolean(session.role === "parent" && session.studentId);

  // Активный выезд для hero и ведомости — производное значение, считаем в рендере,
  // а не отдельным состоянием (иначе рассинхрон при перезагрузке данных).
  const active = useMemo(
    () => excursions.find((e) => e.id === activeId) ?? null,
    [excursions, activeId],
  );

  return (
    <div className="kv-app">
      <AppHeader />
      {transparency && (
        <Suspense fallback={<SkeletonLoader />}>
          <TransparencyScreen onClose={() => setTransparency(false)} />
        </Suspense>
      )}
      {isParent ? (
        <Suspense fallback={<SkeletonLoader />}>
          <ParentScreen
            studentId={session.studentId!}
            studentName={session.resolvedStudentName ?? undefined}
            excursions={excursions}
            children={children}
            onSelectChild={(studentId, studentName) =>
              setSession({ role: "parent", studentId, resolvedStudentId: studentId, resolvedStudentName: studentName })
            }
          />
        </Suspense>
      ) : (
        <>
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
            <button className={`kv-tab ${tab === "class" ? "active" : ""}`} onClick={() => setTab("class")}>
              Импорт класса
            </button>
          </div>

          {/* на вкладке импорта скелетон не нужен: экран не зависит от первичной загрузки */}
          {loading && tab !== "class" && <SkeletonLoader />}

          {!loading && tab === "trips" && (
            <>
              {/* Hero — выезд, который учитель ведёт прямо сейчас (не «большая цифра») */}
              {active && (
                <section className="kv-hero" aria-label="Текущий выезд">
                  <div className="kv-hero-top">
                    <div>
                      <h1 className="kv-hero-title">{active.title}</h1>
                      <p className="kv-hero-where">{active.location_name}</p>
                    </div>
                    {active.status === "VOTING" && <span className="kv-chip">сбор ответов</span>}
                  </div>
                  <dl className="kv-hero-when">
                    <div>
                      <dt>Дата</dt>
                      <dd>{active.event_date ?? "уточняется"}</dd>
                    </div>
                    {active.gathering_time && (
                      <div>
                        <dt>Сбор</dt>
                        <dd>{active.gathering_time}</dd>
                      </div>
                    )}
                    {active.return_time && (
                      <div>
                        <dt>Возвращение</dt>
                        <dd>{active.return_time}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Билет</dt>
                      <dd>{active.ticket_price > 0 ? `${active.ticket_price.toFixed(0)} ₽` : "бесплатно"}</dd>
                    </div>
                  </dl>
                </section>
              )}
              <Suspense fallback={<SkeletonLoader />}>
                <ExcursionsScreen excursions={excursions} activeId={activeId} onSelect={setActiveId} />
                {activeId && <DashboardScreen excursionId={activeId} onChange={reload} />}
              </Suspense>
            </>
          )}

          {!loading && tab === "catalog" && (
            <Suspense fallback={<SkeletonLoader />}>
              <CatalogScreen
                classes={classes}
                onCreated={async (id) => {
                  await reload();
                  setActiveId(id);
                  setTab("trips");
                }}
              />
            </Suspense>
          )}

          {/* монтируем всегда при активной вкладке: после импорта reload() не должен
              размонтировать экран и стирать показанный результат */}
          {tab === "class" && (
            <Suspense fallback={<SkeletonLoader />}>
              <ImportScreen
                onImported={async () => {
                  await reload();
                }}
              />
            </Suspense>
          )}

          {!isInsideMax() && !transparency && (
            <ViewPanel
              classes={classes}
              onChange={reload}
              onOpenParent={(studentId, studentName) =>
                setSession({ role: "parent", studentId, resolvedStudentId: studentId, resolvedStudentName: studentName })
              }
            />
          )}
        </>
      )}

      <Footer onOpenTransparency={() => setTransparency(true)} />
    </div>
  );
}

/** Шапка: знак ClassGo, название, подзаголовок. */
function AppHeader() {
  return (
    <div className="kv-header">
      <div className="kv-logo" aria-hidden="true">
        CG
      </div>
      <div>
        <p className="kv-title">ClassGo</p>
        <p className="kv-subtitle">Школьные выезды: согласия, билеты, приказ</p>
      </div>
    </div>
  );
}

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
  // Плоский список учеников всех классов — пересчитываем только при смене классов,
  // а не на каждый рендер (разворачивание панели, сообщение и т.п.).
  const students = useMemo(
    () => classes.flatMap((c) => c.students.map((s) => ({ ...s, klass: c.title }))),
    [classes],
  );
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
        <b>Режим просмотра (вне MAX)</b>
        <button className="kv-btn ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Свернуть" : "Развернуть"}
        </button>
      </div>
      {open && (
        <>
          <p className="kv-muted" style={{ marginTop: 8 }}>
            Ручная проверка без мессенджера: откройте экран родителя и сбросьте демо для повторного
            прохода сценария.
          </p>
          <div className="kv-filters">
            <select
              defaultValue=""
              aria-label="Открыть экран родителя"
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

function Footer({ onOpenTransparency }: { onOpenTransparency: () => void }) {
  const inside = isInsideMax();
  return (
    <div className="kv-footer-note">
      платформа {platform()} · {deviceName()} · MAX {maxVersion()}
      {!inside && <> · запущено вне MAX</>}
      {startParam() && <> · контекст {startParam()}</>}
      <br />
      Данные каталога — модельные (снапшот PRO.Культура.РФ / «Пушкинская карта»). Оплата билетов —
      напрямую на сайте учреждения культуры.
      <br />
      <button type="button" className="kv-linkbtn" onClick={onOpenTransparency}>
        Прозрачность: данные и согласие
      </button>
    </div>
  );
}
