'use client';
import { useState, useEffect } from 'react';
import type { Piece } from '@/lib/types';
import Modal from './Modal';
import Chip from './Chip';

export default function TimePicker({
  piece, initDate, initTime, hasExisting, onSave, onRemove, onClose,
}: {
  piece: Piece; initDate: string; initTime: string; hasExisting: boolean;
  onSave: (d:string,t:string)=>void; onRemove:()=>void; onClose:()=>void;
}) {
  const [date,setDate]=useState(initDate);
  const [time,setTime]=useState(initTime);
  useEffect(()=>{setDate(initDate);setTime(initTime)},[initDate,initTime]);

  return <Modal open onClose={onClose} small>
    <div className="schedule-modal">
      <div className="schedule-modal-head">
        <div>
          <span className="schedule-modal-kicker">{hasExisting ? 'EDIT SCHEDULE' : 'SCHEDULE POST'}</span>
          <h3>Choose when to publish</h3>
          <div className="schedule-modal-channel"><Chip channel={piece.channel}/><span>{piece.format || piece.section}</span></div>
        </div>
        <button type="button" className="schedule-modal-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="schedule-modal-body">
        <div className="field"><label htmlFor="tp-d">Date</label><input className="input schedule-input" type="date" id="tp-d" value={date} onChange={e=>setDate(e.target.value)}/></div>
        <div className="field"><label htmlFor="tp-t">Time</label><input className="input schedule-input" type="time" id="tp-t" value={time} onChange={e=>setTime(e.target.value)} autoFocus/></div>
      </div>
      <div className="schedule-modal-actions">
        {hasExisting && <button className="btn btn-danger schedule-cancel" onClick={onRemove}>Cancel scheduled post</button>}
        <span className="schedule-actions-spacer" />
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
        <button className="btn btn-primary schedule-save" onClick={()=>{if(date&&time)onSave(date,time)}}>{hasExisting?'Move post':'Schedule post'}</button>
      </div>
    </div>
  </Modal>;
}
