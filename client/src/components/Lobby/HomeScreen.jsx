import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Modal from '../ui/Modal';
import { createRoom } from '../../hooks/useSocket';
import { SERVER_URL } from '../../utils/constants';
import useStore from '../../store/useStore';
import { Video, Users, Mic, MonitorSmartphone, Clock, Link, Copy, Check, Shield, Calendar, LogOut } from 'lucide-react';

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
  const wasKicked = searchParams.get('kicked') === 'true';

  const store = useStore;

  useEffect(() => {
    if (!store.getState().roomId) {
      store.getState().resetAll();
    }
  }, []);

  useEffect(() => {
    const savedName = localStorage.getItem('webinar-name');
    if (savedName) setDisplayName(savedName);
  }, []);

  const getInviteLink = (roomId) => {
    return `${window.location.origin}/meeting/${roomId}`;
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

      const response = await fetch(`${SERVER_URL}/api/rooms`, {
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

  const handleLogout = () => {
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
      // Fallback
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
      navigate(`/meeting/${createdMeeting.roomId}`);
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
    navigate(`/meeting/${joinRoomId.trim()}`);
  };

  return (
    <div className="min-h-screen bg-meeting-bg flex flex-col">
      <header className="px-8 py-5 flex items-center gap-2">
        <Video className="text-primary" size={28} />
        <h1 className="text-2xl font-bold">Webinar</h1>
        <span className="text-sm text-gray-400 ml-2 hidden sm:block">Video Conferencing</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-gray-400">Signed in as <span className="text-gray-200 font-medium">Admin</span></span>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-meeting-surface border border-meeting-border hover:bg-white/10 hover:border-red-500/40 text-gray-300 hover:text-red-400 transition-colors"
          >
            <LogOut size={15} />
            Logout
          </button>
        </div>
      </header>

      {wasKicked && (
        <div className="mx-auto mt-4 px-4 py-3 bg-yellow-900/40 border border-yellow-700 rounded-lg text-yellow-200 max-w-md">
          You were removed from the meeting by the host.
        </div>
      )}

      <main className="flex-1 flex items-center justify-center px-4 py-12">
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
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}
          </div>

          <div className="grid grid-cols-2 gap-6">
            {[
              { icon: <Video size={24} />, title: 'HD Video', desc: 'Crystal-clear video calls' },
              { icon: <Mic size={24} />, title: 'Clear Audio', desc: 'Noise-cancelled sound' },
              { icon: <MonitorSmartphone size={24} />, title: 'Screen Share', desc: 'Present any screen' },
              { icon: <Shield size={24} />, title: 'Password Protected', desc: 'Optional meeting passwords' }
            ].map((feature, i) => (
              <div
                key={i}
                className="p-5 bg-meeting-surface border border-meeting-border rounded-xl hover:border-primary/40 transition-colors"
              >
                <div className="text-primary mb-3">{feature.icon}</div>
                <h3 className="font-semibold mb-1">{feature.title}</h3>
                <p className="text-sm text-gray-400">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="px-8 py-4 text-center text-sm text-gray-500">
        Free video meetings for up to unlimited participants
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
    </div>
  );
}
