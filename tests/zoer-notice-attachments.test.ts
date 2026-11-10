import {it,expect} from 'vitest';
import {attachmentInventory,attachmentFileName} from '../zoer/dashboard/notice-attachments';
it('distinguishes source links from saved originals, including partial and failed downloads',()=>{
 const links=[{url:'a',name:'Scope.pdf'},{url:'b',name:'Declaration.docx'},{url:'c',name:'Terms'}];
 const docs=[{id:'one',url:'a',name:'Scope.pdf',status:'downloaded',bytes:20},{id:'two',url:'b',name:'Declaration.docx',status:'failed',bytes:0},{id:'three',url:'c',name:'Terms',status:'downloaded',bytes:0}];
 const rows=attachmentInventory(links,docs);expect(rows.filter(r=>r.saved)).toHaveLength(1);expect(rows.map(r=>r.saved?.id)).toEqual(['one',undefined,undefined]);
 expect(attachmentFileName('Terms','application/pdf')).toBe('Terms.pdf');
 expect(attachmentFileName('Form.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('Form.xlsx');
});
