/** Workers 標準の crypto.randomUUID() を使った ID 生成。接頭辞でテーブルを判別しやすくする。 */
export function newId(prefix: 'cat' | 'log' | 'qz' | 'nb' | 'tmr' | 'acc' | 'usr' | 'tsk'): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
