import { useState } from "react";
import { api, type ImportResult } from "../api";
import { haptic } from "../max";

/**
 * Импорт класса из файла (UC-1). Ручной ввод детей исключён: учитель приносит
 * привычную выгрузку из школьной системы (CSV или XLSX), а ClassGo заводит
 * класс целиком — учеников и контакты родителей (включая маму и папу).
 *
 * Формат CSV — как в artifacts/sample_class_import.csv:
 *   ФИО, Дата рождения, Телефон родителя
 * плюс необязательные колонки «Телефон мамы» / «Телефон папы» (и ФИО родителей).
 */
export default function ImportScreen({ onImported }: { onImported: (classId: number) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [grade, setGrade] = useState("8");
  const [letter, setLetter] = useState("А");
  const [schoolNumber, setSchoolNumber] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  function pick(next: File | null) {
    setFile(next);
    setResult(null);
    setError(null);
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.importClass(file, {
        grade,
        letter,
        school_number: schoolNumber,
        teacher_name: teacherName,
      });
      setResult(r);
      haptic();
      onImported(r.class_id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="kv-card">
        <p className="kv-section">Заведение класса</p>
        <p className="kv-muted" style={{ marginTop: 0 }}>
          Загрузите список класса файлом CSV или XLSX. Колонки: ФИО, дата рождения,
          телефон родителя. Поддерживаются отдельные колонки «Телефон мамы» и
          «Телефон папы» — тогда у ученика сразу будет два законных представителя.
        </p>

        <div className="kv-filters" style={{ marginTop: 12 }}>
          <label className="kv-chip">
            класс
            <input
              type="text"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              aria-label="Параллель"
              style={{ width: 40, border: "none", outline: "none", background: "transparent", font: "inherit" }}
            />
          </label>
          <label className="kv-chip">
            литера
            <input
              type="text"
              value={letter}
              onChange={(e) => setLetter(e.target.value)}
              aria-label="Литера класса"
              style={{ width: 28, border: "none", outline: "none", background: "transparent", font: "inherit" }}
            />
          </label>
          <label className="kv-chip">
            школа
            <input
              type="text"
              value={schoolNumber}
              onChange={(e) => setSchoolNumber(e.target.value)}
              placeholder="№ гимназии"
              aria-label="Номер школы"
              style={{ width: 110, border: "none", outline: "none", background: "transparent", font: "inherit" }}
            />
          </label>
          <label className="kv-chip">
            классный руководитель
            <input
              type="text"
              value={teacherName}
              onChange={(e) => setTeacherName(e.target.value)}
              placeholder="ФИО"
              aria-label="Классный руководитель"
              style={{ width: 150, border: "none", outline: "none", background: "transparent", font: "inherit" }}
            />
          </label>
        </div>

        {/* label + hidden input: нативный выбор файла без программного клика */}
        <label className="kv-dropzone">
          <input
            type="file"
            accept=".csv,.xlsx,.xlsm,text/csv"
            aria-label="Выбрать файл списка класса"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            hidden
          />
          {file ? (
            <>
              <b>{file.name}</b>
              <span className="kv-muted">{Math.max(1, Math.round(file.size / 1024))} КБ, нажмите чтобы заменить</span>
            </>
          ) : (
            <>
              <b>Выбрать файл списка класса</b>
              <span className="kv-muted">CSV или XLSX. Перетаскивание не требуется, просто нажмите.</span>
            </>
          )}
        </label>

        <div className="kv-actions">
          <button className="kv-btn primary" disabled={!file || busy} onClick={submit}>
            {busy ? "Загружаем…" : "Загрузить класс"}
          </button>
          {file && (
            <button className="kv-btn ghost" disabled={busy} onClick={() => pick(null)}>
              Отмена
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="kv-alert err" role="alert">
          Не удалось загрузить класс: {error}
        </div>
      )}

      {result && (
        <div className="kv-card">
          <p className="kv-section">{result.title}</p>
          <table className="kv-table">
            <tbody>
              <tr>
                <td className="kv-key">Учеников</td>
                <td className="kv-data">{result.students_created}</td>
              </tr>
              <tr>
                <td className="kv-key">Родителей</td>
                <td className="kv-data">{result.parents_created}</td>
              </tr>
              <tr>
                <td className="kv-key">Пропущено</td>
                <td className="kv-data">{result.skipped_rows.length}</td>
              </tr>
            </tbody>
          </table>

          {result.skipped_rows.length > 0 && (
            <div className="kv-alert info" style={{ marginTop: 10 }}>
              <b>Строки, которые не удалось разобрать:</b>
              <ul className="kv-skipped">
                {result.skipped_rows.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="kv-muted" style={{ marginTop: 10 }}>
            Класс появился в списке. Теперь выберите событие в каталоге — участники
            добавятся автоматически.
          </p>
          <div className="kv-actions">
            <button className="kv-btn" onClick={() => onImported(result.class_id)}>
              К каталогу событий
            </button>
          </div>
        </div>
      )}
    </>
  );
}
