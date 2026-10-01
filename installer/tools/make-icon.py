# Makes installer/DeepslateWorks.ico (16-256 px, PNG frames) from apps/web/public/icon.svg, drawn by hand: no image libraries.
# python3 installer/tools/make-icon.py installer/DeepslateWorks.ico; the 2.0.x script carries it as $IconBase64.
import struct, zlib, base64, sys
# apps/web/public/icon.svg at 32 units: rounded tile #202226 rx 6, four 9x9 squares
SQ = [((6,6),(91,96,104)),((17,6),(59,63,70)),((6,17),(59,63,70)),((17,17),(217,130,63))]
BG = (32,34,38)
def inside_round(x,y,r=6.0,w=32.0):
    cx = min(max(x, r), w-r); cy = min(max(y, r), w-r)
    return (x-cx)**2 + (y-cy)**2 <= r*r
def render(n, ss=4):
    rows=[]
    for py in range(n):
        row=bytearray([0])
        for px in range(n):
            acc=[0,0,0,0]
            for sy in range(ss):
                for sx in range(ss):
                    x=(px+(sx+.5)/ss)*32/n; y=(py+(sy+.5)/ss)*32/n
                    if not inside_round(x,y): continue
                    c=BG
                    for (ox,oy),col in SQ:
                        if ox<=x<ox+9 and oy<=y<oy+9: c=col
                    acc[0]+=c[0];acc[1]+=c[1];acc[2]+=c[2];acc[3]+=1
            k=ss*ss
            if acc[3]: row+=bytes([acc[0]//acc[3],acc[1]//acc[3],acc[2]//acc[3],255*acc[3]//k])
            else: row+=bytes([0,0,0,0])
        rows.append(bytes(row))
    raw=b"".join(rows)
    def chunk(t,d): return struct.pack(">I",len(d))+t+d+struct.pack(">I",zlib.crc32(t+d)&0xffffffff)
    return b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",n,n,8,6,0,0,0))+chunk(b"IDAT",zlib.compress(raw,9))+chunk(b"IEND",b"")
sizes=[16,24,32,48,64,256]
pngs=[render(s) for s in sizes]
hdr=struct.pack("<HHH",0,1,len(sizes)); off=6+16*len(sizes); ents=b""
for s,p in zip(sizes,pngs):
    ents+=struct.pack("<BBBBHHII",s%256,s%256,0,0,1,32,len(p),off); off+=len(p)
ico=hdr+ents+b"".join(pngs)
open(sys.argv[1] if len(sys.argv) > 1 else "DeepslateWorks.ico","wb").write(ico)

print(len(ico), len(base64.b64encode(ico)))
