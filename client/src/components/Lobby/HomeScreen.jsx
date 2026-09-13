import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import RecordingsSection from './RecordingsSection';
import { SERVER_URL } from '../../utils/constants';
import apiFetch from '../../utils/api';
import useStore from '../../store/useStore';
import {
  Video, Users, Mic, MonitorSmartphone, Clock, Link, Copy, Check, Shield, Calendar,
  LogOut, CalendarPlus, Play, Trash2, Download, ExternalLink, CalendarClock, MonitorPlay
} from 'lucide-react';
import {
  MEETING_STATUS,
  computeMeetingStatus,
  formatMeetingTime,
  toLocalInputValue
} from '../../utils/schedule';

export default function HomeScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [createdMeeting, setCreatedMeeting] = useState(null);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [meetingName, setMeetingName] = useState('');
  const [meetingPassword, setMeetingPassword] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Scheduled meetings (task 18)
  const [scheduledMeetings, setScheduledMeetings] = useState([]);
  const [meetingsLoading, setMeetingsLoading] = useState(true);
  const [meetingsError, setMeetingsError] = useState('');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [schedTitle, setSchedTitle] = useState('');
  const [schedStart, setSchedStart] = useState('');
  const [schedDurationMin, setSchedDurationMin] = useState(60);
  const [schedWaitingRoom, setSchedWaitingRoom] = useState(false);
  const [schedPasscode, setSchedPasscode] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [startingId, setStartingId] = useState(null);
  const [actionError, setActionError] = useState('');

  const wasKicked = searchParams.get('kicked') === 'true';
  const wasDenied = searchParams.get('denied') === 'true';

  const store = useStore;
  const user = store((s) => s.user);
  const username = store((s) => s.username);

  useEffect(() => {
    if (!store.getState().roomId) {
      store.getState().resetAll();
    }
  }, []);

  useEffect(() => {
    const savedName = localStorage.getItem('webinar-name');
    if (savedName) setDisplayName(savedName);
  }, []);

  const fetchMeetings = useCallback(async () => {
    setMeetingsLoading(true);
    setMeetingsError('');
    try {
      const res = await apiFetch('/api/meetings');
      if (!res.ok) throw new Error('Failed to load meetings');
      const data = await res.json();
      setScheduledMeetings(data.meetings || []);
    } catch (err) {
      setMeetingsError('Could not load scheduled meetings.');
    } finally {
      setMeetingsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  const getInviteLink = (roomId) => {
    return `${window.location.origin}/join?room=${roomId}`;
  };

  const handleCreateRoom = async () => {
    if (!displayName.trim()) {
      setError('Please enter your name');
      return;
    }
    setError('');
    setIsCreating(true);

    try {
      localStorage.setItem('webinar-name', displayName);
      store.getState().setDisplayName(displayName);

      const response = await apiFetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostName: displayName,
          roomName: meetingName.trim() || null,
          password: meetingPassword || null
        })
      });

      if (!response.ok) throw new Error('Failed to create room');

      const { roomId, roomName, hasPassword } = await response.json();

      store.getState().setRoomPassword(hasPassword ? meetingPassword : null);
      store.getState().setRoomName(roomName);

      setCreatedMeeting({
        roomId,
        roomName,
        link: getInviteLink(roomId),
        hasPassword,
        password: hasPassword ? meetingPassword : null
      });
      setShowShareModal(true);
      setIsCreating(false);
    } catch (err) {
      console.error('Create room error:', err);
      setError('Failed to create room. Is the server running?');
      setIsCreating(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch(`${SERVER_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
    } catch { /* server unreachable: still clear the local session */ }
    store.getState().resetAll();
    store.getState().logout();
    navigate('/login');
  };

  const handleCopyLink = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleJoinFromShareModal = () => {
    if (createdMeeting) {
      store.getState().setDisplayName(displayName);
      if (createdMeeting.hasPassword) {
        store.getState().setRoomPassword(createdMeeting.password);
      }
      setShowShareModal(false);
      navigate(`/join?room=${createdMeeting.roomId}`);
    }
  };

  const handleJoin = () => {
    if (!displayName.trim()) {
      setError('Please enter your name');
      return;
    }
    if (!joinRoomId.trim()) {
      setError('Please enter a meeting ID');
      return;
    }
    setError('');

    localStorage.setItem('webinar-name', displayName);
    store.getState().setDisplayName(displayName);
    navigate(`/join?room=${joinRoomId.trim()}`);
  };

  const openScheduleModal = () => {
    const defaultStart = new Date(Date.now() + 60 * 60 * 1000);
    defaultStart.setMinutes(0, 0, 0);
    setSchedTitle('');
    setSchedStart(toLocalInputValue(defaultStart.getTime()));
    setSchedDurationMin(60);
    setSchedWaitingRoom(false);
    setSchedPasscode('');
    setScheduleError('');
    setShowScheduleModal(true);
  };

  const handleSchedule = async () => {
    if (!schedTitle.trim()) {
      setScheduleError('Please enter a meeting title');
      return;
    }
    const startMs = new Date(schedStart).getTime();
    if (!Number.isFinite(startMs)) {
      setScheduleError('Please pick a start date and time');
      return;
    }
    if (startMs <= Date.now()) {
      setScheduleError('Start time must be in the future');
      return;
    }
    const endMs = startMs + schedDurationMin * 60 * 1000;
    setScheduleError('');
    setIsScheduling(true);

    try {
      const res = await apiFetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: schedTitle.trim(),
          startTime: startMs,
          endTime: endMs,
          passcode: schedPasscode.trim() || null,
          waitingRoomEnabled: schedWaitingRoom
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to schedule meeting');

      if (data.meeting.hasPasscode && schedPasscode.trim()) {
        sessionStorage.setItem(`webinar-meeting-pass-${data.meeting.id}`, schedPasscode.trim());
      }
      setShowScheduleModal(false);
      fetchMeetings();
    } catch (err) {
      setScheduleError(err.message || 'Failed to schedule meeting');
    } finally {
      setIsScheduling(false);
    }
  };

  const handleStartMeeting = async (meeting) => {
    setStartingId(meeting.id);
    setActionError('');
    try {
      const res = await apiFetch(`/api/meetings/${meeting.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || 'Could not start this meeting');
        setStartingId(null);
        return;
      }
      localStorage.setItem('webinar-name', username || 'Host');
      store.getState().setDisplayName(username || 'Host');
      store.getState().setRoomName(data.roomName);
      if (data.hasPassword) {
        const pass = sessionStorage.getItem(`webinar-meeting-pass-${meeting.id}`);
        if (pass) store.getState().setRoomPassword(pass);
      }
      navigate(`/meeting/${data.roomId}`);
    } catch (err) {
      setActionError('Could not reach the server. Is it running?');
      setStartingId(null);
    }
  };

  const handleDeleteMeeting = async (meeting) => {
    setActionError('');
    try {
      const res = await apiFetch(`/api/meetings/${meeting.id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Delete failed');
      fetchMeetings();
    } catch (err) {
      setActionError('Could not delete the meeting.');
    }
  };

  const statusMeta = {
    [MEETING_STATUS.ENDED]: { label: 'Ended', cls: 'bg-gray-700/40 text-gray-400' },
    [MEETING_STATUS.LIVE]: { label: 'Live now', cls: 'bg-green-600/20 text-green-400' },
    [MEETING_STATUS.UPCOMING]: { label: 'Upcoming', cls: 'bg-primary/20 text-primary' }
  };

  return (
    <div className="app-screen-min bg-meeting-bg flex flex-col">
      <header className="px-4 sm:px-8 py-4 sm:py-5 flex items-center gap-2">
        <Video className="text-primary" size={24} />
        <h1 className="text-xl sm:text-2xl font-bold">Webinar</h1>
        <span className="text-sm text-gray-400 ml-2 hidden md:block">Video Conferencing</span>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <span className="text-xs sm:text-sm text-gray-400 hidden sm:block">Signed in as <span className="text-gray-200 font-medium">{user?.name || username || 'Guest'}</span></span>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm bg-meeting-surface border border-meeting-border hover:bg-white/10 hover:border-red-500/40 text-gray-300 hover:text-red-400 transition-colors"
            aria-label="Logout"
          >
            <LogOut size={15} />
            <span className="hidden xs:inline">Logout</span>
          </button>
        </div>
      </header>

      {wasKicked && (
        <div className="mx-auto mt-4 px-4 py-3 bg-yellow-900/40 border border-yellow-700 rounded-lg text-yellow-200 max-w-md">
          You were removed from the meeting by the host.
        </div>
      )}

      {wasDenied && (
        <div className="mx-auto mt-4 px-4 py-3 bg-yellow-900/40 border border-yellow-700 rounded-lg text-yellow-200 max-w-md">
          The host did not admit you to that meeting. You can join a different one below.
        </div>
      )}

      {actionError && (
        <div className="mx-auto mt-4 px-4 py-3 bg-red-900/40 border border-red-700 rounded-lg text-red-200 max-w-md">
          {actionError}
        </div>
      )}

      <main className="flex-1 flex flex-col items-center px-4 py-8 overflow-y-auto">
        <div className="grid lg:grid-cols-2 gap-12 max-w-5xl w-full items-center">
          <div className="space-y-8">
            <h2 className="text-4xl font-bold leading-tight">
              Video meetings for{' '}
              <span className="text-primary">everyone</span>
            </h2>
            <p className="text-gray-400 text-lg max-w-md">
              Connect, collaborate, and communicate with unlimited participants.
              HD video, clear audio, screen sharing, and real-time chat.
            </p>

            <div className="space-y-3">
              <Input
                label="Your Name"
                placeholder="Enter your display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="max-w-sm"
                icon={<Users size={16} />}
              />
              <Input
                label="Meeting Name"
                placeholder="e.g. Team Standup"
                value={meetingName}
                onChange={(e) => setMeetingName(e.target.value)}
                className="max-w-sm"
                icon={<Calendar size={16} />}
              />
              <div className="flex flex-col sm:flex-row gap-3 max-w-sm">
                <Input
                  placeholder="Meeting password (optional)"
                  value={meetingPassword}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                    setMeetingPassword(val);
                  }}
                  icon={<Shield size={16} />}
                  type="password"
                  maxLength={6}
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <Button
                size="lg"
                onClick={handleCreateRoom}
                disabled={isCreating}
                className="flex items-center gap-2"
              >
                {isCreating ? 'Creating...' : 'New Meeting'}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => setShowJoinModal(true)}
                className="flex items-center gap-2"
              >
                Join Meeting
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={openScheduleModal}
                className="flex items-center gap-2 border border-meeting-border"
              >
                <CalendarPlus size={18} />
                Schedule
              </Button>
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {[
              { icon: <Video size={24} />, title: 'HD Video', desc: 'Crystal-clear video calls' },
              { icon: <Mic size={24} />, title: 'Clear Audio', desc: 'Noise-cancelled sound' },
              { icon: <MonitorSmartphone size={24} />, title: 'Screen Share', desc: 'Present any screen' },
              { icon: <Shield size={24} />, title: 'Password Protected', desc: 'Optional meeting passwords' }
            ].map((feature) => (
              <div
                key={feature.title}
                className="p-5 bg-meeting-surface border border-meeting-border rounded-xl hover:border-primary/40 transition-colors"
              >
                <div className="text-primary mb-3">{feature.icon}</div>
                <h3 className="font-semibold mb-1">{feature.title}</h3>
                <p className="text-sm text-gray-400">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Scheduled meetings */}
        <section className="max-w-5xl w-full mt-12">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <CalendarClock size={18} className="text-primary" /> Scheduled Meetings
            </h3>
            <button
              onClick={openScheduleModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-primary hover:bg-primary-dark text-white transition-colors"
            >
              <CalendarPlus size={15} /> Schedule
            </button>
          </div>

          {meetingsLoading && (
            <div className="text-sm text-gray-400 bg-meeting-surface border border-meeting-border rounded-xl p-6">
              Loading scheduled meetings…
            </div>
          )}

          {!meetingsLoading && meetingsError && (
            <div className="text-sm text-red-400 bg-meeting-surface border border-red-800/40 rounded-xl p-6">
              {meetingsError}
            </div>
          )}

          {!meetingsLoading && !meetingsError && scheduledMeetings.length === 0 && (
            <div className="text-sm text-gray-400 bg-meeting-surface border border-meeting-border rounded-xl p-6">
              No scheduled meetings yet. Click <span className="text-primary">Schedule</span> to plan one ahead.
            </div>
          )}

          {!meetingsLoading && scheduledMeetings.length > 0 && (
            <div className="space-y-3">
              {scheduledMeetings.map((meeting) => {
                const status = computeMeetingStatus(meeting);
                const meta = statusMeta[status] || { label: 'Upcoming', cls: 'bg-primary/20 text-primary' };
                return (
                  <div
                    key={meeting.id}
                    className="bg-meeting-surface border border-meeting-border rounded-xl p-4 flex flex-col md:flex-row md:items-center gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-semibold truncate">{meeting.title}</h4>
                        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-medium ${meta.cls}`}>
                          {meta.label}
                        </span>
                        {meeting.hasPasscode && (
                          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-meeting-card text-gray-400 font-medium">
                            Passcode
                          </span>
                        )}
                        {meeting.waitingRoomEnabled && (
                          <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-meeting-card text-gray-400 font-medium">
                            Waiting room
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-400 mt-1 flex items-center gap-1.5">
                        <Clock size={13} /> {formatMeetingTime(meeting.startTime, meeting.endTime)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {status !== MEETING_STATUS.ENDED && (
                        <Button
                          size="sm"
                          onClick={() => handleStartMeeting(meeting)}
                          disabled={startingId === meeting.id}
                          className="flex items-center gap-1.5"
                        >
                          <Play size={13} />
                          {startingId === meeting.id ? 'Starting…' : 'Start'}
                        </Button>
                      )}
                      {status === MEETING_STATUS.ENDED && (
                        <span className="text-xs text-gray-500 px-2 py-1">Meeting has ended</span>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleCopyLink(meeting.invite.joinUrl)}
                        className="flex items-center gap-1.5"
                        title="Copy invite link"
                      >
                        {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                        Link
                      </Button>
                      <a
                        href={`${SERVER_URL}${meeting.invite.icsPath}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-meeting-surface hover:bg-white/10 text-gray-200 border border-meeting-border transition-colors"
                        title="Download .ics calendar file"
                      >
                        <Download size={13} /> ICS
                      </a>
                      <a
                        href={meeting.invite.googleCalendarUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-meeting-surface hover:bg-white/10 text-gray-200 border border-meeting-border transition-colors"
                        title="Add to Google Calendar"
                      >
                        <ExternalLink size={13} /> Calendar
                      </a>
                      <button
                        onClick={() => handleDeleteMeeting(meeting)}
                        className="p-2 rounded-lg bg-meeting-surface hover:bg-red-600/20 text-gray-400 hover:text-red-400 border border-meeting-border transition-colors"
                        title="Delete meeting"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Recordings */}
        <section className="max-w-5xl w-full mt-12">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <MonitorPlay size={18} className="text-primary" /> Recordings
          </h3>
          <RecordingsSection />
        </section>
      </main>

      <footer className="px-8 py-4 text-center text-sm text-gray-500">
        Video meetings/Conferencing for up to unlimited participants | Developed by Arindam Raychoudhury
      </footer>

      {/* Share Link Modal (shown after room is created) */}
      {showShareModal && createdMeeting && (
        <Modal
          isOpen={showShareModal}
          onClose={() => { setShowShareModal(false); }}
          title="Meeting Created"
        >
          <div className="space-y-5">
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-3">
                <Link size={24} className="text-primary" />
              </div>
              <h3 className="font-semibold text-lg">Meeting is ready</h3>
              <p className="text-gray-400 text-sm mt-1">Share this link with participants to join</p>
            </div>

            <div className="bg-meeting-surface rounded-lg p-3 border border-meeting-border">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Meeting Name</p>
              <p className="text-gray-200 text-sm">{createdMeeting.roomName}</p>
            </div>

            <div className="bg-meeting-bg rounded-lg p-3 border border-meeting-border">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Invite Link</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm text-gray-200 truncate select-all bg-transparent">
                  {createdMeeting.link}
                </code>
                <button
                  onClick={() => handleCopyLink(createdMeeting.link)}
                  className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                  title="Copy link"
                >
                  {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                </button>
              </div>
            </div>

            {createdMeeting.hasPassword && (
              <div className="bg-yellow-900/30 border border-yellow-700/40 rounded-lg p-3">
                <p className="text-[10px] text-yellow-500 uppercase tracking-wide mb-1">Meeting Password</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-lg tracking-[0.2em] font-mono text-yellow-200 select-all">
                    {createdMeeting.password}
                  </code>
                  <button
                    onClick={() => handleCopyLink(createdMeeting.password)}
                    className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                    title="Copy password"
                  >
                    {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                  </button>
                </div>
                <p className="text-xs text-yellow-600/70 mt-1.5">
                  Share this password with participants separately — they will be prompted to enter it when joining.
                </p>
              </div>
            )}

            {!createdMeeting.hasPassword && (
              <div className="bg-meeting-surface rounded-lg p-3 border border-meeting-border">
                <p className="text-xs text-gray-400">
                  No password required. Anyone with the link can join directly.
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="primary"
                className="flex-1 flex items-center justify-center gap-2"
                onClick={handleJoinFromShareModal}
              >
                Join as Host
              </Button>
              <Button
                variant="secondary"
                className="flex items-center justify-center gap-2 px-4"
                onClick={() => handleCopyLink(createdMeeting.link)}
              >
                {copied ? <><Check size={16} className="text-green-400" /> Copied</> : <><Copy size={16} /> Copy Link</>}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Join Meeting Modal */}
      {showJoinModal && (
        <Modal
          isOpen={showJoinModal}
          onClose={() => { setShowJoinModal(false); setError(''); }}
          title="Join Meeting"
        >
          <div className="space-y-4">
            <Input
              label="Meeting ID"
              placeholder="Enter meeting ID (e.g. a1b2c3d4)"
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value.replace(/[^a-zA-Z0-9-]/g, ''))}
              icon={<Clock size={16} />}
            />
            <Input
              label="Your Name"
              placeholder="Enter your name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              icon={<Users size={16} />}
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <Button
              variant={joinRoomId && displayName ? 'primary' : 'secondary'}
              className="w-full"
              onClick={handleJoin}
              disabled={!joinRoomId || !displayName}
            >
              Join Now
            </Button>
          </div>
        </Modal>
      )}

      {/* Schedule Meeting Modal */}
      {showScheduleModal && (
        <Modal
          isOpen={showScheduleModal}
          onClose={() => setShowScheduleModal(false)}
          title="Schedule a Meeting"
        >
          <div className="space-y-4">
            <Input
              label="Title"
              placeholder="e.g. Product Review"
              value={schedTitle}
              onChange={(e) => { setSchedTitle(e.target.value); setScheduleError(''); }}
              autoFocus
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-gray-300 mb-1.5 block">Start time</label>
                <input
                  type="datetime-local"
                  value={schedStart}
                  min={toLocalInputValue(Date.now())}
                  onChange={(e) => { setSchedStart(e.target.value); setScheduleError(''); }}
                  className="input-field w-full"
                />
              </div>
              <div>
                <label className="text-sm text-gray-300 mb-1.5 block">Duration</label>
                <select
                  value={schedDurationMin}
                  onChange={(e) => setSchedDurationMin(Number(e.target.value))}
                  className="input-field w-full"
                >
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={90}>1.5 hours</option>
                  <option value={120}>2 hours</option>
                  <option value={180}>3 hours</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm text-gray-300 mb-1.5 block">Passcode (optional, 6 digits)</label>
              <input
                type="password"
                value={schedPasscode}
                onChange={(e) => setSchedPasscode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="e.g. 123456"
                className="input-field w-full"
                maxLength={6}
              />
              <p className="text-xs text-gray-500 mt-1">
                Shared with participants when they join. Remember it before starting.
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={schedWaitingRoom}
                onChange={(e) => setSchedWaitingRoom(e.target.checked)}
                className="w-4 h-4 rounded border-meeting-border accent-[#4f8cff]"
              />
              <span className="text-sm text-gray-300">Enable waiting room (host admits each joiner)</span>
            </label>

            {scheduleError && <p className="text-red-400 text-sm">{scheduleError}</p>}

            <div className="flex gap-3 pt-1">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setShowScheduleModal(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleSchedule}
                disabled={isScheduling}
              >
                {isScheduling ? 'Scheduling…' : 'Schedule Meeting'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}