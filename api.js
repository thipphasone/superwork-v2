const BASE_URL = 'https://endpoint.superwork.tech/api/v1';

const SuperWorkAPI = {
  _extractError(json, fallback) {
    const sr = json && json.result && json.result.serviceResult;
    return sr && sr.message ? sr.message : fallback;
  },

  async login(identified, pin) {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identified, pin })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(this._extractError(json, `HTTP ${res.status}`));
    return json.result.data;
  },

  async getProfile(token) {
    const res = await fetch(`${BASE_URL}/auth/profile`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const json = await res.json();
    if (!res.ok) throw new Error(this._extractError(json, `HTTP ${res.status}`));
    return json.result.data;
  },

  async getAllRecords(token) {
    const res = await fetch(`${BASE_URL}/check-in-out-v2/records`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const json = await res.json();
    if (!res.ok) throw new Error(this._extractError(json, `HTTP ${res.status}`));
    return (json.result.data && json.result.data.records) || [];
  },

  async getTodayRecord(token) {
    const records = await this.getAllRecords(token);
    const today = new Date().toISOString().slice(0, 10);
    return records.find(r => r.dateRequest === today) || null;
  },

  async checkInOut(token, { imageBlob, attendanceStatus, latitude, longitude, accuracy, address }) {
    const fd = new FormData();
    fd.append('type', 'Check_In_Out');
    fd.append('attendance_status', attendanceStatus);
    fd.append('image', imageBlob, 'selfie.jpg');
    fd.append('latitude', String(latitude));
    fd.append('longitude', String(longitude));
    fd.append('accuracy', String(accuracy));
    if (address) fd.append('address', address);
    const res = await fetch(`${BASE_URL}/check-in-out-v2/records`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: fd
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(this._extractError(json, `HTTP ${res.status}`));
    return json;
  }
};
