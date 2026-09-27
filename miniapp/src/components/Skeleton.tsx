/**
 * Скелетон загрузки: повторяет форму будущего контента, чтобы не было
 * «мёртвой» пустоты и прыжков вёрстки (CLS). Используется для верхнего
 * уровня приложения, каталога и ведомости выезда.
 */
export default function SkeletonLoader() {
  return (
    <>
      <div className="kv-card kv-skeleton" aria-hidden="true">
        <div className="kv-skel-line w60" />
        <div className="kv-skel-line w90" />
        <div className="kv-skel-line w80" />
        <div className="kv-skel-bar" />
      </div>
      <div className="kv-card kv-skeleton" aria-hidden="true">
        <div className="kv-skel-line w40" />
        <div className="kv-skel-line w90" />
      </div>
    </>
  );
}
