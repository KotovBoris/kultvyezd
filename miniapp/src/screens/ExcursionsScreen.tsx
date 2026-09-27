import type { Excursion } from "../api";

/** Журнал выездов класса: строки выбирают активный выезд для hero и дашборда. */
export default function ExcursionsScreen({
  excursions,
  activeId,
  onSelect,
}: {
  excursions: Excursion[];
  activeId: number | null;
  onSelect: (id: number) => void;
}) {
  if (!excursions.length) {
    return (
      <div className="kv-card">
        <p className="kv-section">Журнал выездов</p>
        <div className="kv-empty">
          Пока ни одного выезда. Соберите первый во вкладке «Каталог событий».
        </div>
      </div>
    );
  }
  return (
    <div className="kv-card">
      <p className="kv-section">Журнал выездов · {excursions.length}</p>
      <table className="kv-table">
        <thead>
          <tr>
            <th>Мероприятие</th>
            <th>Дата</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {excursions.map((e) => {
            const active = e.id === activeId;
            return (
              <tr key={e.id} className={active ? "is-active" : undefined}>
                <td>
                  {/* Кнопка, а не tr onClick: строка выбирается и с клавиатуры */}
                  <button
                    type="button"
                    className="kv-rowbtn"
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelect(e.id)}
                  >
                    <b>{e.title}</b>
                    <span className="kv-muted">{e.location_name}</span>
                  </button>
                </td>
                <td className="kv-data">{e.event_date ?? "—"}</td>
                <td className="kv-muted kv-nowrap">{e.status === "VOTING" ? "сбор ответов" : e.status}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
