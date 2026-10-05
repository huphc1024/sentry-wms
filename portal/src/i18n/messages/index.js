/**
 * The message tables, assembled from one file per namespace.
 *
 * Split rather than kept in one file because every page conversion adds
 * its own keys. A single table would put all of them in one place that
 * every change has to touch, and would turn reviewing a page's new
 * Vietnamese into a hunt through a two-thousand-line diff. A namespace's
 * keys live in the file its name points at, and retiring a namespace is
 * deleting a file.
 *
 * Files are picked up by globbing the directory rather than by an import
 * list. Forty-seven pages are still to be converted, and an import list
 * would be forty-seven chances to add the file and forget the line --
 * which fails silently, as a page rendering its key names instead of its
 * text. Dropping a file in is now the whole of the registration.
 *
 * The exported shape is unchanged -- `{ messages: { en, vi } }` -- so
 * locale.jsx never had to learn about any of this.
 */

const PARTS = Object.values(
  import.meta.glob('./*.js', { eager: true }),
).filter((m) => m.en && m.vi);

export const messages = {
  en: Object.assign({}, ...PARTS.map((p) => p.en)),
  vi: Object.assign({}, ...PARTS.map((p) => p.vi)),
};
