/**
 * Célula de CSV segura para abrir no Excel, no LibreOffice e no Google
 * Planilhas.
 *
 * Texto que começa com `=`, `+`, `-`, `@`, tab ou retorno de carro vira
 * **fórmula** quando a planilha abre o arquivo. Nome de lead vem do perfil do
 * WhatsApp, do que o cliente digitou ou de planilha importada — tudo fora do
 * nosso controle —, e um `=HYPERLINK(...)` no nome executaria no computador de
 * quem exportou. O apóstrofo na frente faz a planilha tratar o valor como
 * texto; é a mitigação recomendada pela OWASP.
 *
 * Depois disso vêm as aspas de sempre: vírgula, aspas ou quebra de linha
 * obrigam o valor a ir entre aspas, com as aspas internas duplicadas.
 */
export function csvCell(value: string): string {
  const neutralized = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(neutralized)
    ? `"${neutralized.replace(/"/g, '""')}"`
    : neutralized;
}
