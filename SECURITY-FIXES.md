# إصلاحات أمنية مقترحة

## 1. إخفاء Supabase Key (حرج)
- انقل المفتاح إلى Netlify Functions (server-side only)
- لا تُرسل المفتاح أبداً للـ client

## 2. تحسين escapeHtml و XSS Protection
```javascript
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}
```

## 3. تحسين showDetails
```javascript
// بدلاً من onclick مع JSON directly
window.showDetails = function(record) {
    let html = '';
    for (let [key, val] of Object.entries(record)) {
        html += `<div class="detail-row">
            <div class="detail-label">${escapeHtml(key)}:</div>
            <div class="detail-value">${escapeHtml(val || '-----')}</div>
        </div>`;
    }
    document.getElementById('detailsContent').innerHTML = html;
    document.getElementById('detailsModal').style.display = 'flex';
};

// في الجدول - استخدم data attributes
html += `<tr>
    <td><strong>${escapeHtml(r['رقم الطلب'])}</strong></td>
    ...
    <td>
        <button class="btn btn-warning btn-sm" 
                onclick="showDetails(this.dataset.record)" 
                data-record='${escapeHtml(JSON.stringify(r))}'>
            <i class="fas fa-eye"></i>
        </button>
    </td>
</tr>`;
```

## 4. إضافة Content Security Policy
```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; script-src 'self' 'unsafe-inline' cdnjs.cloudflare.com cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' cdnjs.cloudflare.com fonts.googleapis.com; font-src cdnjs.cloudflare.com fonts.gstatic.com;">
```

## 5. إضافة Rate Limiting على Client-side
```javascript
let lastRequestTime = {};
function rateLimit(action, cooldownMs = 2000) {
    const now = Date.now();
    if (lastRequestTime[action] && now - lastRequestTime[action] < cooldownMs) {
        return false;
    }
    lastRequestTime[action] = now;
    return true;
}

// استخدام
if (!rateLimit('login', 5000)) {
    alert('انتظر قليلاً قبل المحاولة مرة أخرى');
    return;
}
```

## 6. تحسين إدارة التوكن
```javascript
// استخدم httpOnly cookies بدلاً من sessionStorage
// إذا كان ذلك ممكناً مع Netlify Functions

// على الأقل، أضف expiry check
function isTokenValid() {
    const tokenExpiry = sessionStorage.getItem('token_expiry');
    if (!tokenExpiry) return true;
    return Date.now() < parseInt(tokenExpiry);
}
```

## 7. إضافة Validations على Client
```javascript
function validateRequestStatus(status) {
    const allowed = ['جديد', 'مرسل للتصديق', 'مرسل للطباعة', 
                     'تمت الطباعة', 'تم التسليم', 'مرفوض', 
                     'مرفوض من التصديق', 'تحت المعالجة', 'طلبات تم إلغائها'];
    return allowed.includes(status);
}
```
