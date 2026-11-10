export interface SavedAttachment {id:string;url:string;name:string;status:string;bytes?:number;media_type?:string;error?:string}
/** A source link is never counted as a saved file. */
export function attachmentInventory(attachments:{url:string;name:string}[],documents:SavedAttachment[]) {
 return attachments.map(attachment=>({attachment,saved:documents.find(doc=>doc.url===attachment.url && doc.status==='downloaded' && (doc.bytes??0)>0)}));
}
export function attachmentFileName(name:string,mediaType?:string) {
 if(/\.[a-z0-9]{2,6}$/i.test(name)) return name;
 const extension=mediaType==='application/pdf'?'.pdf':mediaType?.includes('spreadsheetml')?'.xlsx':mediaType?.includes('wordprocessingml')?'.docx':'';
 return name+extension;
}
