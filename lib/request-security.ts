export class RequestError extends Error {
  status:number;
  constructor(message:string,status:number){super(message);this.status=status;}
}

// Bound the stream itself: Content-Length may be absent or untrustworthy.
export async function readJsonRequest(request:Request,maxBytes:number):Promise<Record<string,unknown>>{
  if(request.headers.get('origin')!==new URL(request.url).origin)throw new RequestError('Cross-origin request rejected.',403);
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new RequestError('JSON request required.',415);
  if(Number(request.headers.get('content-length'))>maxBytes)throw new RequestError('Request is too large.',413);
  const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(reader)for(;;){
    const part=await reader.read();if(part.done)break;
    size+=part.value.byteLength;
    if(size>maxBytes){await reader.cancel();throw new RequestError('Request is too large.',413);}
    chunks.push(part.value);
  }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let body:unknown;
  try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw new RequestError('Invalid JSON request.',400);}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new RequestError('Invalid request.',400);
  return body as Record<string,unknown>;
}
