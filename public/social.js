'use strict';

const state = {
  campaigns: []
};

const els = {
  form: document.getElementById('eventForm'),
  type: document.getElementById('eventType'),
  title: document.getElementById('eventTitle'),
  description: document.getElementById('eventDescription'),
  playable: document.getElementById('eventPlayable'),
  playableRow: document.getElementById('playableRow'),
  season: document.getElementById('eventSeason'),
  seasonRow: document.getElementById('seasonRow'),
  message: document.getElementById('formMessage'),
  campaigns: document.getElementById('campaigns'),
  template: document.getElementById('campaignTemplate'),
  refresh: document.getElementById('refreshButton'),
  statDraft: document.getElementById('statDraft'),
  statApproved: document.getElementById('statApproved'),
  statScheduled: document.getElementById('statScheduled'),
  statTotal: document.getElementById('statTotal')
};

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `Request failed: ${response.status}`);
  }

  return body;
}

function setMessage(text, kind = '') {
  els.message.textContent = text;
  els.message.dataset.kind = kind;
}

function updateConditionalFields() {
  const type = els.type.value;
  els.playableRow.hidden = type !== 'new_release';
  els.seasonRow.hidden = type !== 'seasonal_promotion';
}

function formatPlatform(name) {
  return {
    facebook: 'Facebook',
    instagram: 'Instagram',
    x: 'X',
    tiktok: 'TikTok',
    youtube_community: 'YouTube Community'
  }[name] || name;
}

function updateStats() {
  const counts = {
    draft: 0,
    approved: 0,
    scheduled: 0
  };

  for (const campaign of state.campaigns) {
    if (counts[campaign.status] !== undefined) {
      counts[campaign.status] += 1;
    }
  }

  els.statDraft.textContent = counts.draft;
  els.statApproved.textContent = counts.approved;
  els.statScheduled.textContent = counts.scheduled;
  els.statTotal.textContent = state.campaigns.length;
}

function createDraftBlock(platform, text) {
  const wrapper = document.createElement('section');
  wrapper.className = 'platform-draft';

  const title = document.createElement('div');
  title.className = 'platform-name';
  title.textContent = formatPlatform(platform);

  const copy = document.createElement('p');
  copy.textContent = text;

  wrapper.append(title, copy);
  return wrapper;
}

function campaignCard(campaign) {
  const fragment = els.template.content.cloneNode(true);
  const card = fragment.querySelector('.campaign-card');
  const meta = fragment.querySelector('.campaign-meta');
  const title = fragment.querySelector('.campaign-title');
  const audience = fragment.querySelector('.campaign-audience');
  const timing = fragment.querySelector('.campaign-timing');
  const status = fragment.querySelector('.status-badge');
  const drafts = fragment.querySelector('.platform-drafts');
  const approve = fragment.querySelector('.approve-button');
  const schedule = fragment.querySelector('.schedule-button');
  const scheduleAt = fragment.querySelector('.schedule-at');

  meta.textContent = `${campaign.priority} • ${campaign.eventType.replaceAll('_', ' ')}`;
  title.textContent = campaign.title;
  audience.textContent = `Audience: ${campaign.audience}`;
  timing.textContent = `Recommended timing: ${campaign.recommendedTiming}`;
  status.textContent = campaign.status.toUpperCase();
  status.dataset.status = campaign.status;

  for (const platform of campaign.platforms) {
    drafts.appendChild(
      createDraftBlock(
        platform,
        campaign.drafts[platform] || ''
      )
    );
  }

  approve.disabled = campaign.status !== 'draft';
  schedule.disabled = campaign.status !== 'approved';
  scheduleAt.disabled = campaign.status !== 'approved';

  approve.addEventListener('click', async () => {
    approve.disabled = true;

    try {
      await api(
        `/api/social/campaigns/${encodeURIComponent(campaign.id)}/approve`,
        { method: 'POST' }
      );
      await loadCampaigns();
    } catch (error) {
      window.alert(error.message);
      approve.disabled = false;
    }
  });

  schedule.addEventListener('click', async () => {
    if (!scheduleAt.value) {
      window.alert('Choose a date and time first.');
      return;
    }

    schedule.disabled = true;

    try {
      await api(
        `/api/social/campaigns/${encodeURIComponent(campaign.id)}/schedule`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            scheduledAt: new Date(scheduleAt.value).toISOString()
          })
        }
      );
      await loadCampaigns();
    } catch (error) {
      window.alert(error.message);
      schedule.disabled = false;
    }
  });

  card.dataset.campaignId = campaign.id;
  return fragment;
}

function renderCampaigns() {
  els.campaigns.replaceChildren();

  if (state.campaigns.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No campaigns yet. Add a verified DripVid event to create the first draft.';
    els.campaigns.appendChild(empty);
    updateStats();
    return;
  }

  const sorted = [...state.campaigns].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt)
  );

  for (const campaign of sorted) {
    els.campaigns.appendChild(campaignCard(campaign));
  }

  updateStats();
}

async function loadCampaigns() {
  const body = await api('/api/social/campaigns');
  state.campaigns = Array.isArray(body.campaigns)
    ? body.campaigns
    : [];
  renderCampaigns();
}

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('Generating campaign…');

  const payload = {
    type: els.type.value,
    title: els.title.value.trim(),
    description: els.description.value.trim()
  };

  if (payload.type === 'new_release') {
    payload.playable = els.playable.checked;
  }

  if (payload.type === 'seasonal_promotion') {
    payload.season = els.season.value.trim();
  }

  try {
    const result = await api('/api/social/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!result.created) {
      if (result.reason === 'release_not_playable') {
        setMessage(
          'Draft not created: this release must be verified playable first.',
          'warning'
        );
      } else {
        setMessage('This event does not require a public campaign.', 'warning');
      }
      return;
    }

    setMessage('Campaign draft created.', 'success');
    els.title.value = '';
    els.description.value = '';
    els.playable.checked = false;
    els.season.value = '';
    await loadCampaigns();
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

els.type.addEventListener('change', updateConditionalFields);
els.refresh.addEventListener('click', () => {
  loadCampaigns().catch((error) => {
    setMessage(error.message, 'error');
  });
});

updateConditionalFields();
loadCampaigns().catch((error) => {
  setMessage(error.message, 'error');
});
