import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx';
import { scientificNameRuns } from './scientific-names.js';
import { mesaName } from './mesas.js';

export function metadataSignature(article) {
  return createHash('sha256').update(JSON.stringify({title:article.title, mesa:article.mesa, keywords:article.keywords,
    authors:article.authors.map(a=>[a.firstName,a.lastName,a.institution,a.email,a.orcid,a.isCorresponding])})).digest('hex');
}
export function presentationKey(article) {
  return 'presentation-' + createHash('sha256').update(JSON.stringify([8,article.documentKey,article.version,metadataSignature(article)])).digest('hex').slice(0,40);
}

function addLastPageMesa(document, article) {
  const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const make=name=>document.createElementNS(W,`w:${name}`);
  const body=document.getElementsByTagNameNS(W,'body')[0];
  const finalSection=Array.from(body.childNodes).find(node=>node.namespaceURI===W&&node.localName==='sectPr');
  if(!finalSection)throw new Error('El documento no tiene propiedades de sección.');
  const paragraph=make('p'),properties=make('pPr');
  const frame=make('framePr');
  for(const [name,value] of [['w','8000'],['h','300'],['hAnchor','page'],['vAnchor','page'],['xAlign','center'],['y','14700'],['wrap','through']])frame.setAttributeNS(W,`w:${name}`,value);
  properties.appendChild(frame);
  const alignment=make('jc');alignment.setAttributeNS(W,'w:val','center');properties.appendChild(alignment);
  paragraph.appendChild(properties);
  for(const [value,bold] of [['Mesa: ',true],[`${mesaName(article.mesa)} (${article.mesa})`,false]]){
    const textRun=make('r'),runProperties=make('rPr');
    const fonts=make('rFonts');fonts.setAttributeNS(W,'w:ascii','Arial');fonts.setAttributeNS(W,'w:hAnsi','Arial');runProperties.appendChild(fonts);
    const size=make('sz');size.setAttributeNS(W,'w:val','20');runProperties.appendChild(size);
    if(bold)runProperties.appendChild(make('b'));
    const text=make('t');text.setAttribute('xml:space','preserve');text.appendChild(document.createTextNode(value));
    textRun.appendChild(runProperties);textRun.appendChild(text);paragraph.appendChild(textRun);
  }
  body.insertBefore(paragraph,finalSection);
}

// Compose a read-only/export copy. Never persist metadata into the editable body.
export async function composePresentation(buffer, article) {
  const run=(text,options={})=>new TextRun({text,font:'Arial',size:20,color:'000000',...options});
  const paragraph=(children,options={})=>new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:100,line:240},children,...options});
  const affiliations=[];
  const authors=article.authors.map(author=>{
    const institution=author.institution.trim();
    let index=affiliations.findIndex(value=>value.toLocaleLowerCase('es-MX')===institution.toLocaleLowerCase('es-MX'));
    if(index<0){index=affiliations.length;affiliations.push(institution)}
    return {...author,affiliation:index+1};
  });
  const correspondingIndex=authors.findIndex(author=>author.isCorresponding);
  const authorRuns=[];
  authors.forEach((author,index)=>{
    if(index) authorRuns.push(run(index===authors.length-1?' y ':', '));
    authorRuns.push(run(`${author.firstName} ${author.lastName}`),run(`${author.affiliation}${index===correspondingIndex?'*':''}`,{superScript:true}));
  });
  const children=[
    paragraph(scientificNameRuns(article.title,{size:28,bold:true,transformText:text=>text.toLocaleUpperCase('es-MX')}),{keepNext:true,spacing:{after:180,line:280}}),
    paragraph(authorRuns,{keepNext:true}),
    ...affiliations.map((institution,index)=>paragraph([run(String(index+1),{superScript:true}),run(' '+institution)],{keepNext:true,spacing:{after:60,line:240}})),
  ];
  const correspondingEmail=authors[correspondingIndex]?.email;
  if(correspondingEmail) children.push(paragraph([run('*Autor para correspondencia: '),run(correspondingEmail)],{keepNext:true}));
  if(article.keywords.length) children.push(paragraph([run('Palabras clave: ',{bold:true}),...scientificNameRuns(article.keywords.join(', ')+'.',{italics:true})],{alignment:AlignmentType.JUSTIFIED,spacing:{before:120,after:160,line:240},keepNext:true}));
  const prefix=await JSZip.loadAsync(await Packer.toBuffer(new Document({sections:[{children}]})));
  const zip=await JSZip.loadAsync(buffer);
  const parser=new DOMParser(), serializer=new XMLSerializer();
  const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const document=parser.parseFromString(await zip.file('word/document.xml').async('string'),'application/xml');
  const metadata=parser.parseFromString(await prefix.file('word/document.xml').async('string'),'application/xml');
  const body=document.getElementsByTagNameNS(W,'body')[0], first=body.firstChild;
  for(const node of Array.from(metadata.getElementsByTagNameNS(W,'body')[0].childNodes)) {
    if(node.localName==='p') body.insertBefore(document.importNode(node,true),first);
  }
  if(article.mesa)addLastPageMesa(document,article);
  zip.file('word/document.xml',serializer.serializeToString(document));
  if (zip.file('word/styles.xml')) {
    const styles=parser.parseFromString(await zip.file('word/styles.xml').async('string'),'application/xml');
    const heading=Array.from(styles.getElementsByTagNameNS(W,'style')).find(node=>node.getAttributeNS(W,'styleId')==='Heading1');
    if(heading){
      let properties=heading.getElementsByTagNameNS(W,'rPr')[0];
      if(!properties){properties=styles.createElementNS(W,'w:rPr');heading.appendChild(properties)}
      for(const [name,value] of [['color','000000'],['sz','20'],['b','true']]){
        let node=properties.getElementsByTagNameNS(W,name)[0];
        if(!node){node=styles.createElementNS(W,'w:'+name);properties.appendChild(node)}
        node.setAttributeNS(W,'w:val',value);
      }
    }
    zip.file('word/styles.xml',serializer.serializeToString(styles));
  }
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
