import type { ReportDocument } from '../../shared/reporting';

export function renderPrintableReport(popup: Window, report: ReportDocument) {
  const document = popup.document;
  document.documentElement.lang = 'en';
  document.head.replaceChildren(); document.body.replaceChildren();
  document.title = `${report.title} | BalikTelaPH`;
  const style = document.createElement('style');
  style.textContent = '@page{size:A4 landscape;margin:16mm}body{font-family:Arial,sans-serif;color:#20332a;margin:32px;font-size:11px;font-variant-numeric:tabular-nums}h1{font-size:24px;margin:8px 0}h2{font-size:14px;margin-top:24px}p,li{line-height:1.6}header{border-bottom:2px solid #22634e;padding-bottom:16px}dt{color:#66736c}dd{margin:4px 0 14px}dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 20px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:9px 8px;text-align:left;border-bottom:1px solid #dfe5e2;overflow-wrap:anywhere}th{background:#f2f5f3}thead{display:table-header-group}tr{break-inside:avoid}footer{margin-top:24px;font-size:10px;color:#66736c}button{padding:8px 16px;background:#22634e;color:white;border:0;cursor:pointer;margin-bottom:20px}@media print{body{margin:0}button{display:none}}';
  document.head.append(style);
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
  };
  const print = element('button', 'Print / Save as PDF'); print.onclick = () => popup.print(); document.body.append(print);
  const header = element('header'); header.append(element('p', 'BalikTelaPH / Operational Report'), element('h1', report.title), element('p', `${report.period.label} / ${report.period.timeZone}`), element('p', `Generated ${new Date(report.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Manila' })} PHT / ${report.scope.role} / ${report.scope.description}`));
  document.body.append(header);
  const summary = element('dl');
  report.summary.forEach(item => { const group = element('div'); group.append(element('dt', item.label), element('dd', item.value)); summary.append(group); });
  document.body.append(summary);
  if (report.interpretation?.length) {
    const interpretation = element('section'); interpretation.setAttribute('aria-label', 'Report interpretation');
    interpretation.append(element('h2', 'Report Interpretation'));
    for (const item of report.interpretation) { const paragraph = element('p'); paragraph.append(element('strong', `${item.label}. `), document.createTextNode(item.text)); interpretation.append(paragraph); }
    document.body.append(interpretation);
  }
  if (report.filters.length) document.body.append(element('p', report.filters.map(item => `${item.label}: ${item.value}`).join(' / ')));
  const table = element('table'); const head = element('thead'); const headRow = element('tr');
  report.columns.forEach(column => { const th = element('th', column); th.scope = 'col'; headRow.append(th); }); head.append(headRow); table.append(head);
  const body = element('tbody');
  report.rows.forEach(row => { const tr = element('tr'); row.forEach(value => tr.append(element('td', value))); body.append(tr); }); table.append(body);
  if (!report.rows.length) document.body.append(element('p', 'No records match this report scope and period.'));
  document.body.append(table);
  const footer = element('footer'); footer.append(element('h2', 'Definitions & limitations'));
  for (const item of report.definitions ?? []) { const paragraph = element('p'); paragraph.append(element('strong', `${item.label}: `), document.createTextNode(item.text)); footer.append(paragraph); }
  const notes = element('ul'); report.notes.forEach(note => notes.append(element('li', note))); footer.append(notes); document.body.append(footer);
}
