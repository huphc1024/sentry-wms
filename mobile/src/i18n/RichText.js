/**
 * A translated sentence with a styled value inside it. The sentence stays
 * one key with `{name}` placeholders -- word order moves between
 * languages, so it is never split into one key per fragment -- and the
 * values (usually <Text style={bold}>) are supplied here. Render inside a
 * <Text>.
 *
 *   <Text><RichText text={t('x.line')} values={{ sku: <Text style={s.b}>{sku}</Text> }} /></Text>
 */
import React, { Fragment } from 'react';

export default function RichText({ text, values = {} }) {
  const parts = String(text ?? '').split(/(\{\w+\})/g);
  return parts.map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    const value = name !== undefined && name in values ? values[name] : part;
    return <Fragment key={i}>{value}</Fragment>;
  });
}
