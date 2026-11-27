"""Plots and a schematic signal view derived from native model identities."""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import numpy as np
from dynamics import wrap

plt.rcParams.update({'font.family':'DejaVu Sans', 'font.size':10, 'svg.fonttype':'none',
                     'axes.spines.top':False, 'axes.spines.right':False, 'svg.hashsalt':'skyview-pendulum'})


def responses(runs, p, output):
    fig, axes = plt.subplots(4,1,figsize=(11,9),sharex=True,layout='constrained')
    colors = {'nominal':'#218d7b','disturbance':'#6e87be','sensorLoss':'#9b852c'}
    labels = {'nominal':'Nominal','disturbance':f"{p['disturbanceForce']:g} N push at {p['disturbanceStart']:g} s",
              'sensorLoss':f"Sensor loss at {p['sensorFaultTime']:g} s"}
    for name, data in runs.items():
        t = data[:,0]; color = colors[name]
        for ax, values in zip(axes,[np.degrees(wrap(data[:,3]-np.pi)),data[:,1],data[:,5],data[:,7]]):
            if ax is axes[0]:
                values = values.copy()
                values[np.r_[False, abs(np.diff(values)) > 180]] = np.nan
            ax.plot(t, values, color=color, lw=1.3, label=labels[name], alpha=.9)
    for ax in axes:
        ax.grid(True, alpha=.2); ax.set_xlim(0,p['horizon'])
    axes[0].set(ylabel='Upright error [deg]',title='Cart-pole swing-up, balance and fault response')
    axes[0].legend(loc='upper right', ncols=3,fontsize=9)
    zoom = axes[0].inset_axes([.25,.45,.33,.35])
    for name in ('nominal','disturbance'):
        data = runs[name]
        zoom.plot(data[:,0],np.degrees(wrap(data[:,3]-np.pi)),color=colors[name],lw=1)
    limit = np.degrees(p['angleTolerance'])
    zoom.axhspan(-limit,limit,color='#d7f1ef',alpha=.4)
    zoom.set(xlim=(p['disturbanceStart']-1,p['recoveryDeadline']),ylim=(-2*limit,2*limit),title='Push recovery [deg]')
    zoom.tick_params(labelsize=7); zoom.title.set_fontsize(8); zoom.grid(alpha=.2)
    axes[1].set_ylabel('Cart position [m]')
    axes[2].set_ylabel('Actuator force [N]')
    axes[3].set(ylabel='Controller mode',xlabel='Time [s]',yticks=[0,1,2],yticklabels=['Swing-up','Balance','Disabled'])
    for ax, limit in [(axes[1],p['railHalfTravel']),(axes[2],p['forceLimit'])]:
        for sign in [-1,1]: ax.axhline(sign*limit,color='#955076',ls='--',lw=.9)
    axes[3].set_ylim(-.15,2.2)
    fig.savefig(output,metadata={'Date':None})
    fig.savefig(output.with_suffix('.png'),dpi=120)
    plt.close(fig)


def control_view(model, output):
    # Only presentation positions and subtitles live here; all nodes and edges
    # are selected from resolved native parts, ports and directed payloads.
    positions = {'controller':(1,4),'actuator':(4,4),'sum':(7,4),'plant':(10,4),
                 'encoders':(10,1.8),'estimator':(4,1.8),'disturbance':(7,6.3)}
    if {b['name'] for b in model['blocks']} != set(positions):
        raise ValueError('Control-loop view selection needs review')
    captions = {'controller':'Energy shaping / LQR','actuator':'Saturation + lag',
                'sum':'+ +','plant':'Nonlinear dynamics + integration',
                'encoders':'Sample + quantize','estimator':'Difference + low-pass',
                'disturbance':'Horizontal force pulse'}
    units = {'Force':'F [N]','State':'x [m], v [m/s], θ [rad], ω [rad/s]',
             'Measurement':'x [m], θ [rad], valid','Estimate':'x, v, θ, ω, valid'}
    fig, ax = plt.subplots(figsize=(13,8),layout='constrained')
    ax.set(xlim=(-.3,11.4),ylim=(0,7.9)); ax.axis('off')
    ax.text(0,7.5,'Inverted pendulum · computational signal loop',fontsize=19,weight='bold')
    ax.text(0,7.12,'InvertedPendulum::ControlLoop · schematic block view derived from native SysML v2',fontsize=10)
    for b in model['blocks']:
        x,y = positions[b['name']]
        box = FancyBboxPatch((x-1.1,y-.45),2.2,.9,boxstyle='round,pad=0.05,rounding_size=0.08',
                             facecolor='#e7f0fc',edgecolor='#4d719b',linewidth=1.5)
        box.set_gid(b['model']); box.set_url('../../examples/inverted-pendulum/InvertedPendulum.sysml')
        ax.add_patch(box)
        ax.text(x,y+.09,b['name']+' : '+b['type'],ha='center',va='center',fontsize=10,weight='bold',color='#203a5b')
        ax.text(x,y-.21,captions[b['name']],ha='center',fontsize=8.5,color='#203a5b')
    for e in model['connections']:
        a,b = e['source'].split('.')[0], e['target'].split('.')[0]
        x1,y1 = positions[a]; x2,y2 = positions[b]
        if a == 'estimator':
            path = [(x1-1.15,y1),(1,y1),(1,3.5)]
            label = (2.15,1.48)
        elif x1 == x2:
            sign = np.sign(y2-y1); path = [(x1,y1+sign*.5),(x2,y2-sign*.5)]
            label = (x1+.18,(y1+y2)/2)
        else:
            sign = np.sign(x2-x1); path = [(x1+sign*1.15,y1),(x2-sign*1.15,y2)]
            label = ((x1+x2)/2,y1+.16)
        for i in range(len(path)-1):
            arrow = FancyArrowPatch(path[i],path[i+1],arrowstyle='->' if i==len(path)-2 else '-',
                                     mutation_scale=13,color='#397366',linewidth=1.5)
            arrow.set_gid(e['model']); ax.add_patch(arrow)
        text = units[e['payload']]
        if e['payload']=='State': text='x, v, θ, ω\n[m, m/s, rad, rad/s]'
        ax.text(*label,text,ha='left' if x1==x2 else 'center',fontsize=8,color='#173f36')
    ax.text(0,.65,'Blue blocks: logical responsibilities   •   Green arrows: directed computational signals',fontsize=10)
    ax.text(0,.28,'Connections are not physical power bonds. Plant integration and actuator lag execute in the optional Python runner.',fontsize=9)
    fig.savefig(output,metadata={'Date':None})
    fig.savefig(output.with_suffix('.png'),dpi=120)
    plt.close(fig)
