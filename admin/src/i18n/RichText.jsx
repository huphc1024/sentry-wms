/**
 * A translated sentence that carries markup inside it.
 *
 * Four paragraphs in the app wrap a value in <strong>, <code> or a
 * mono <span> in the middle of a sentence. Splitting those into one
 * key per fragment is how translations get mangled: word order moves
 * between languages, and a translator handed three half-sentences has
 * no way to put them back together. So the sentence stays one key,
 * placeholders and all, and the markup is supplied here.
 *
 * `t(key)` called without vars leaves `{name}` in place, which is what
 * this splits on.
 *
 *   <RichText
 *     text={t('backorders.cancelWarning')}
 *     values={{ so: <strong>{row.so_number}</strong> }}
 *   />
 */
import { Fragment } from 'react';

export default function RichText({ text, values = {} }) {
  const parts = String(text ?? '').split(/(\{\w+\})/g);
  return parts.map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    // An unknown placeholder stays visible rather than vanishing, the
    // same bargain `interpolate` makes: a hole in a sentence is a bug
    // someone reports, and silence is a bug nobody sees.
    const value = name !== undefined && name in values ? values[name] : part;
    return <Fragment key={i}>{value}</Fragment>;
  });
}
