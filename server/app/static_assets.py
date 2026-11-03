"""Serve build-time compressed, content-hashed assets with immutable caching."""
import mimetypes
import anyio
from starlette.staticfiles import StaticFiles
from starlette.datastructures import Headers

class PrecompressedAssets(StaticFiles):
    async def get_response(self,path,scope):
        headers=Headers(scope=scope);accepted={}
        for item in headers.get('accept-encoding','').split(','):
            bits=item.strip().split(';');quality=1.0
            for parameter in bits[1:]:
                if parameter.strip().startswith('q='):
                    try:quality=float(parameter.strip()[2:])
                    except ValueError:quality=0
            accepted[bits[0].lower()]=quality
        encoded=None;selected=path
        if not headers.get('range'):
            for encoding,suffix in [('br','.br'),('gzip','.gz')]:
                if accepted.get(encoding,0)>0:
                    full,stat=await anyio.to_thread.run_sync(self.lookup_path,path+suffix)
                    if stat is not None:selected=path+suffix;encoded=encoding;break
        response=await super().get_response(selected,scope)
        response.headers['Cache-Control']='public, max-age=31536000, immutable'
        response.headers['Vary']='Accept-Encoding'
        if encoded:
            response.headers['Content-Encoding']=encoded
            response.headers['Content-Type']='application/javascript' if path.endswith(('.js','.mjs')) else mimetypes.guess_type(path)[0] or 'application/octet-stream'
        return response