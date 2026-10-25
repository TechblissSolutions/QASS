'use client';
export default function StoreLoading() {
  return <div className="page-container" aria-busy="true"><div className="page-head"><div><div className="skel" style={{width:180,height:28}}/><div className="skel" style={{width:280,height:14,marginTop:10}}/></div></div><div className="board" style={{marginTop:24}}><div className="skel" style={{height:120}}/><div className="skel" style={{height:120}}/><div className="skel" style={{height:120}}/></div></div>;
}
