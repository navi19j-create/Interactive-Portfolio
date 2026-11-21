"""Draw the three original digital prints for the rotunda at web display size."""
import math
import random
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parents[1] / 'dist/cardboard-gallery/media'


def edition(name, image, grain=4):
    paper = np.asarray(image.convert('RGB'), dtype=np.float32)
    noise = np.random.default_rng(74).normal(0, grain, (*paper.shape[:2], 1))
    result = Image.fromarray(np.clip(paper + noise, 0, 255).astype('uint8'))
    result.save(OUT / (name + '.webp'), quality=88, method=6)


def night_ferry():
    rng = random.Random(27)
    w, h = 1280, 884
    ink, paper, rust = '#263738', '#ece0c6', '#bd5f40'
    im = Image.new('RGB', (w, h), paper)
    d = ImageDraw.Draw(im)
    d.ellipse((803, 124, 982, 303), fill=rust)
    ridge = [(x, 373 + 27*math.sin(x/156) + 12*math.sin(x/52) + 4*math.sin(x/22)) for x in range(0, w+8, 8)]
    d.polygon(ridge + [(w, 435), (0, 435)], fill='#71776c')
    d.rectangle((0, 429, w, h), fill=ink)
    for i in range(1250):
        y = rng.uniform(445, h)
        x = rng.uniform(-50, w)
        length = rng.uniform(5, 47) * (.4 + (y/h)**3)
        d.line([(x, y), (x+length*.55, y-1), (x+length, y-1.8)], fill=rng.choice([paper, '#778078', '#526562']), width=rng.choice([1, 2, 3]))
    # A late crossing, with a dark hull and a wheelhouse cut out of the silhouette.
    d.polygon([(166,409),(705,409),(669,463),(266,471),(201,447)],fill=ink)
    d.polygon([(259,405),(276,367),(493,363),(514,406)],fill=ink)
    for i in range(7):
        x=288+28*i
        d.polygon([(x,374),(x+18,374),(x+16,390),(x-2,390)],fill=paper)
    d.polygon([(452,359),(445,303),(469,301),(482,358)],fill=rust)
    d.line((584,402,580,239),fill=ink,width=5)
    d.line((580,243,674,404),fill=ink,width=2)
    d.line((579,253,499,395),fill=ink,width=2)
    d.line((214,427,691,423),fill=paper,width=4)
    for i in range(72):
        x=rng.uniform(178,704);y=rng.uniform(540,808)
        d.line((x,y,x+rng.uniform(3,21),y-1),fill=rust,width=2)
    edition('night-ferry',im)


def fern_plate():
    rng=random.Random(12)
    w,h=852,1180
    mask=Image.new('L',(w,h))
    d=ImageDraw.Draw(mask)
    def frond(bx,by,angle,length,width):
        ux,uy=math.sin(angle),-math.cos(angle)
        vx,vy=-uy,ux
        def point(t):
            bend=.16*length*t*t
            return bx+ux*t*length+vx*bend, by+uy*t*length+vy*bend
        d.line([point(i/80) for i in range(81)],fill=245,width=4)
        for i in range(1,29):
            t=i/30
            px,py=point(t)
            reach=width*(1-t)**.65*min(1,.32+t*7)
            for side in (-1,1):
                dx,dy=side*vx*.9+ux*.48,side*vy*.9+uy*.48
                size=reach*rng.uniform(.90,1.03)
                d.line((px,py,px+dx*size,py+dy*size),fill=239,width=2)
                for k in range(1,14):
                    u=k/14
                    lx,ly=px+dx*size*u,py+dy*size*u
                    leaf=(.022*length+4)*(1-u*.8)*(1-t*.68)
                    for flip in (-1,1):
                        tx,ty=lx+dx*leaf*.60-dy*leaf*flip,ly+dy*leaf*.60+dx*leaf*flip
                        d.polygon([(lx,ly),(lx+dx*leaf*.30-dy*leaf*.32*flip,ly+dy*leaf*.30+dx*leaf*.32*flip),(tx,ty),(lx+dx*leaf*.58,ly+dy*leaf*.58)],fill=rng.randint(195,255))
    frond(429,1118,-.35,899,190);frond(464,1117,.26,1030,164);frond(407,1080,-.72,489,105)
    yy,xx=np.mgrid[:h,:w]
    wash=(np.sin(xx/160+yy/208)*2.7+np.cos(yy/81)*1.5)[...,None]
    plate=np.array([24.,68.,110.])+wash
    silhouette=np.asarray(mask.filter(ImageFilter.GaussianBlur(.45)))[...,None]/255.
    image=Image.fromarray((plate*(1-silhouette)+np.array([220,232,219])*silhouette).astype('uint8'))
    edition('fern-plate',image,3)


def ochre_steps():
    im=Image.new('RGB',(920,1100),'#ebd9b4');d=ImageDraw.Draw(im)
    d.rectangle((78,85,842,1014),fill='#ce9755')
    d.ellipse((503,149,706,352),fill='#f1d583')
    d.polygon([(78,627),(505,396),(842,465),(842,1014),(78,1014)],fill='#ae5038')
    d.polygon([(130,715),(415,565),(415,810),(130,965)],fill='#5a4041')
    d.polygon([(415,565),(594,611),(594,855),(415,810)],fill='#ca7649')
    for i in range(9):
        x,y=229+i*47,976-i*44
        d.polygon([(x,y),(x+77,y-39),(x+130,y-26),(x+53,y+14)],fill='#efce91')
        d.polygon([(x+53,y+14),(x+130,y-26),(x+130,y-8),(x+53,y+32)],fill='#79453b')
    edition('ochre-steps',im)


if __name__=='__main__':
    night_ferry()
    fern_plate()
    ochre_steps()
