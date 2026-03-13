#!/usr/bin/env python3
"""
generate_site.py — Reads TJ MARRIAGE.xlsx from Google Drive and builds docs/index.html.

Usage:
    python tools/generate_site.py

Output:
    docs/index.html
"""

import json
import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(__file__))
from gws import download_workbook

WEDDING_DATE = date(2026, 12, 27)
OUTPUT_PATH  = os.path.join(os.path.dirname(__file__), "..", "docs", "index.html")


# ── Data readers ──────────────────────────────────────────────────────────────

def read_timeline(wb):
    ws = wb["Timeline  Task List"]
    tasks = []
    today = date.today()
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[0]:
            continue
        # Skip stray URL rows (e.g. ChatGPT share links)
        if str(row[0]).startswith("http"):
            continue
        task, owner, status, deadline = row[0], row[1], row[2], row[3]
        if isinstance(deadline, datetime):
            deadline = deadline.date()
        # Determine effective status
        effective = status or "Not Started"
        if effective not in ("Booked", "Done") and deadline and deadline < today:
            effective = "Overdue"
        tasks.append({
            "task":     task,
            "owner":    owner or "—",
            "status":   effective,
            "deadline": deadline,
        })
    return tasks


def read_budget(wb):
    ws = wb["Budget + Vendor Tracker"]
    # Columns: Category, Vendor, Status, Actual, Balance, Notes, Low, Mid, High
    SKIP = {"Total", "Total + buffer", "Miscellaneous & Contingency (10%)"}
    rows = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[0] or row[0] in SKIP:
            continue
        rows.append({
            "category": row[0],
            "vendor":   row[1] or "",
            "actual":   row[3],
            "balance":  row[4],
            "notes":    row[5] or "",
        })
    return rows


def read_vendors(wb):
    ws = wb["Budget + Vendor Tracker"]
    # Columns: Category, Vendor, Status, Actual, Balance, Notes, Low, Mid, High
    SKIP = {"Total", "Total + buffer", "Miscellaneous & Contingency (10%)"}
    vendors = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[0] or row[0] in SKIP:
            continue
        vendors.append({
            "type":   row[0],
            "name":   row[1] or "",
            "status": row[2] or "Pending",
        })
    return vendors


def read_guests(wb):
    ws = wb["Guest List"]
    # Columns: #, Name, Side, Group, Role, +1?, Pax, Status, Notes, Table#
    rows = []
    total_pax = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[0] or not isinstance(row[0], (int, float)):
            continue
        pax   = int(row[6]) if isinstance(row[6], (int, float)) else 1
        table = int(row[9]) if isinstance(row[9], (int, float)) else None
        rows.append({
            "num":    int(row[0]),
            "name":   str(row[1]).strip() if row[1] else "",
            "side":   str(row[2]).strip() if row[2] else "",
            "group":  str(row[3]).strip() if row[3] else "",
            "role":   str(row[4]).strip() if row[4] else "",
            "plus1":  str(row[5]).strip() if row[5] else "No",
            "pax":    pax,
            "status": str(row[7]).strip() if row[7] else "TBC",
            "notes":  str(row[8]).strip() if row[8] else "",
            "table":  table,
        })
        total_pax += pax
    return {"total": int(total_pax), "rows": rows}


def read_schedule(wb):
    ws = wb["Schedule"]
    items = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row[0]:
            continue
        # Clean up encoding artifacts (emoji dashes etc)
        time_str = str(row[0]).encode("ascii", "ignore").decode("ascii").strip()
        activity = str(row[1]).encode("ascii", "ignore").decode("ascii").strip() if row[1] else ""
        if time_str and activity:
            items.append({"time": time_str, "activity": activity})
    return items


# ── HTML builders ─────────────────────────────────────────────────────────────

STATUS_BADGE = {
    "Booked":      ("bg-emerald-100 text-emerald-800 border border-emerald-300", "Booked"),
    "Done":        ("bg-emerald-100 text-emerald-800 border border-emerald-300", "Done"),
    "Ongoing":     ("bg-amber-100 text-amber-800 border border-amber-300",       "Ongoing"),
    "Not Started": ("bg-stone-100 text-stone-500 border border-stone-300",       "Not Started"),
    "Overdue":     ("bg-rose-100 text-rose-800 border border-rose-300",          "Overdue"),
}

VENDOR_STATUS_BADGE = {
    "Booked":     ("bg-emerald-100 text-emerald-800 border border-emerald-300", "Booked"),
    "Finalizing": ("bg-blue-100 text-blue-800 border border-blue-300",          "Finalizing"),
    "Looking":    ("bg-amber-100 text-amber-800 border border-amber-300",       "Looking"),
    "Pending":    ("bg-stone-100 text-stone-500 border border-stone-300",       "Pending"),
    "Not Booked": ("bg-stone-100 text-stone-400 border border-stone-300",       "Not Booked"),
}


def fmt_php(val):
    if val is None:
        return "—"
    return f"₱{val:,.0f}"


def fmt_date(d):
    if d is None:
        return "—"
    return d.strftime("%b %d, %Y")


ROLE_BADGE = {
    "VIP / Principal Sponsor (Ninong/Ninang)": ("bg-amber-100 text-amber-800 border border-amber-200", "Principal Sponsor"),
    "MOH":                        ("bg-rose-100 text-rose-700 border border-rose-200",    "MOH"),
    "Best Man":                   ("bg-rose-100 text-rose-700 border border-rose-200",    "Best Man"),
    "Entourage - Bridesmaid":     ("bg-pink-100 text-pink-700 border border-pink-200",    "Bridesmaid"),
    "Entourage - Groomsmen":      ("bg-blue-100 text-blue-700 border border-blue-200",    "Groomsman"),
    "Candle":                     ("bg-stone-100 text-stone-500 border border-stone-200", "Candle"),
    "Cord":                       ("bg-stone-100 text-stone-500 border border-stone-200", "Cord"),
    "Veil":                       ("bg-stone-100 text-stone-500 border border-stone-200", "Veil"),
    "Ring":                       ("bg-stone-100 text-stone-500 border border-stone-200", "Ring"),
    "Flower Girl":                ("bg-purple-100 text-purple-700 border border-purple-200", "Flower Girl"),
}

def build_html(tasks, budget, vendors, schedule, guests):
    today          = date.today()
    days_to_go     = (WEDDING_DATE - today).days
    booked_count   = sum(1 for v in vendors if v["status"] == "Booked")
    total_vendors  = len(vendors)
    total_actual   = sum(r["actual"] for r in budget if r["actual"])
    overdue_count  = sum(1 for t in tasks if t["status"] == "Overdue")

    # Guest list rows + filter options
    guest_groups = sorted(set(g["group"] for g in guests["rows"] if g["group"]))
    group_options = "".join(f'<option value="{grp}">{grp}</option>' for grp in guest_groups)

    guest_rows = ""
    for g in guests["rows"]:
        side_cls   = "bg-rose-50 text-rose-700" if g["side"] == "Jeyan" else "bg-blue-50 text-blue-700"
        role_info  = ROLE_BADGE.get(g["role"])
        role_badge = f'<span class="px-1.5 py-0.5 rounded text-xs font-medium {role_info[0]}">{role_info[1]}</span>' if role_info else ""
        table_str  = f"Table {g['table']}" if g["table"] else '<span class="text-stone-300">—</span>'
        guest_rows += f"""
        <tr class="hover:bg-stone-50 transition-colors" data-side="{g['side']}" data-group="{g['group']}">
          <td class="px-3 py-2 text-sm font-medium text-stone-800">{g['name']}</td>
          <td class="px-3 py-2 text-xs text-stone-500">{g['group']}</td>
          <td class="px-3 py-2 text-xs">{role_badge}</td>
          <td class="px-3 py-2 text-center"><span class="text-xs font-semibold px-1.5 py-0.5 rounded {side_cls}">{g['side']}</span></td>
          <td class="px-3 py-2 text-xs text-center text-stone-500">{g['pax']}{'<span class="text-emerald-600 font-bold"> +1</span>' if g["plus1"] == "Yes" else ''}</td>
          <td class="px-3 py-2 text-xs text-stone-500 text-center">{table_str}</td>
        </tr>"""

    # Budget chart data
    chart_labels = [r["category"][:22] + "…" if len(r["category"]) > 22 else r["category"] for r in budget]
    chart_actual = [r["actual"] or 0 for r in budget]

    chart_labels_js = json.dumps(chart_labels)
    chart_actual_js = json.dumps(chart_actual)

    # Timeline rows
    timeline_rows = ""
    for t in tasks:
        cls, label = STATUS_BADGE.get(t["status"], STATUS_BADGE["Not Started"])
        deadline_str = fmt_date(t["deadline"])
        row_cls = "bg-rose-50" if t["status"] == "Overdue" else "hover:bg-stone-50"
        timeline_rows += f"""
        <tr class="{row_cls} transition-colors">
          <td class="px-4 py-3 text-sm text-stone-800">{t['task']}</td>
          <td class="px-4 py-3 text-sm text-stone-500 text-center">{t['owner']}</td>
          <td class="px-4 py-3 text-center">
            <span class="px-2 py-0.5 rounded-full text-xs font-medium {cls}">{label}</span>
          </td>
          <td class="px-4 py-3 text-sm text-stone-500 text-center">{deadline_str}</td>
        </tr>"""

    # Budget rows
    budget_rows = ""
    for r in budget:
        actual_cls  = "text-emerald-700 font-semibold" if r["actual"] else "text-stone-300"
        balance_cls = "text-rose-600 font-semibold" if (r["balance"] or 0) > 0 else "text-stone-300"
        vendor_display = r["vendor"] if r["vendor"] else '<span class="italic text-stone-300">TBD</span>'
        budget_rows += f"""
        <tr class="hover:bg-stone-50 transition-colors">
          <td class="px-4 py-3 text-sm text-stone-800">{r['category']}</td>
          <td class="px-4 py-3 text-sm text-stone-500">{vendor_display}</td>
          <td class="px-4 py-3 text-sm text-right {actual_cls}">{fmt_php(r['actual'])}</td>
          <td class="px-4 py-3 text-sm text-right {balance_cls}">{fmt_php(r['balance'])}</td>
        </tr>"""

    # Vendor cards
    vendor_cards = ""
    for v in vendors:
        v_cls, v_label = VENDOR_STATUS_BADGE.get(v["status"], VENDOR_STATUS_BADGE["Not Booked"])
        name_display = v["name"] if v["name"] else '<span class="text-stone-300 italic">TBD</span>'
        card_border  = "border-emerald-200 bg-emerald-50/30" if v["status"] == "Booked" else "border-stone-200 bg-white"
        vendor_cards += f"""
        <div class="rounded-xl border {card_border} p-4 flex flex-col gap-2 hover:shadow-md transition-shadow">
          <div class="text-xs font-semibold text-stone-400 uppercase tracking-widest">{v['type']}</div>
          <div class="text-sm font-medium text-stone-800">{name_display}</div>
          <span class="self-start px-2 py-0.5 rounded-full text-xs font-medium {v_cls}">{v_label}</span>
        </div>"""

    # Schedule items
    schedule_items = ""
    for i, item in enumerate(schedule):
        dot_cls = "bg-[#8B1A35]" if i == 0 else "bg-stone-300"
        schedule_items += f"""
        <div class="flex gap-4 items-start">
          <div class="flex flex-col items-center">
            <div class="w-3 h-3 rounded-full {dot_cls} mt-1 flex-shrink-0"></div>
            {'<div class="w-px flex-1 bg-stone-200 mt-1"></div>' if i < len(schedule)-1 else ''}
          </div>
          <div class="pb-6">
            <div class="text-xs font-semibold text-[#8B1A35] uppercase tracking-widest mb-0.5">{item['time']}</div>
            <div class="text-sm text-stone-700">{item['activity']}</div>
          </div>
        </div>"""

    # Overdue alert
    overdue_banner = ""
    if overdue_count:
        overdue_banner = f"""
    <div class="max-w-6xl mx-auto px-6 mb-4">
      <div class="bg-rose-50 border border-rose-200 rounded-xl px-5 py-3 flex items-center gap-3">
        <span class="text-rose-600 text-lg">&#9888;</span>
        <span class="text-rose-700 text-sm font-medium">{overdue_count} task{"s" if overdue_count != 1 else ""} overdue — review the timeline below.</span>
      </div>
    </div>"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tommy &amp; Jeyan — Wedding Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    :root {{
      --burgundy: #8B1A35;
      --gold:     #B5924C;
      --cream:    #FAF7F2;
    }}
    body {{ background-color: var(--cream); font-family: 'Inter', sans-serif; }}
    .serif {{ font-family: 'Cormorant Garamond', Georgia, serif; }}
    .section-card {{ background: white; border: 1px solid #E8E0D5; border-radius: 16px; }}
    @keyframes fadeUp {{
      from {{ opacity: 0; transform: translateY(16px); }}
      to   {{ opacity: 1; transform: translateY(0); }}
    }}
    .animate-fadeup {{ animation: fadeUp 0.6s ease both; }}
    .delay-1 {{ animation-delay: 0.1s; }}
    .delay-2 {{ animation-delay: 0.2s; }}
    .delay-3 {{ animation-delay: 0.3s; }}
    .delay-4 {{ animation-delay: 0.4s; }}
    .delay-5 {{ animation-delay: 0.5s; }}
    .delay-6 {{ animation-delay: 0.6s; }}
    .stat-pill {{
      background: white;
      border: 1px solid #E8E0D5;
      border-radius: 12px;
      padding: 16px 24px;
    }}
    .divider-ornament {{
      display: flex; align-items: center; gap: 12px; margin: 0 auto;
    }}
    .divider-ornament::before, .divider-ornament::after {{
      content: ''; flex: 1; height: 1px; background: #D4C5B0;
    }}
  </style>
</head>
<body class="min-h-screen">

  <!-- ── HERO HEADER ─────────────────────────────────────────────────────── -->
  <header class="relative overflow-hidden" style="background: linear-gradient(160deg, #2D0A16 0%, #5A1525 50%, #8B1A35 100%);">
    <div class="absolute inset-0 opacity-10" style="background-image: repeating-linear-gradient(45deg, transparent, transparent 30px, rgba(181,146,76,0.3) 30px, rgba(181,146,76,0.3) 31px);"></div>
    <div class="relative max-w-6xl mx-auto px-6 py-16 text-center">
      <p class="text-[#B5924C] text-xs tracking-[0.4em] uppercase mb-4 animate-fadeup">The Wedding of</p>
      <h1 class="serif text-6xl md:text-7xl text-white font-light italic mb-2 animate-fadeup delay-1">Tommy &amp; Jeyan</h1>
      <div class="divider-ornament w-48 mx-auto my-5 animate-fadeup delay-2">
        <span class="text-[#B5924C] text-lg">&#10022;</span>
      </div>
      <p class="serif text-2xl text-[#E8D5B5] font-light animate-fadeup delay-2">December 27, 2026 &nbsp;&bull;&nbsp; St. Therese Parish, BGC</p>
      <div id="countdown" class="mt-8 flex justify-center gap-6 animate-fadeup delay-3">
        <div class="text-center">
          <div id="cnt-days" class="serif text-5xl text-white font-light">—</div>
          <div class="text-[#B5924C] text-xs tracking-widest uppercase mt-1">Days</div>
        </div>
        <div class="serif text-4xl text-[#B5924C] font-light self-start mt-1">:</div>
        <div class="text-center">
          <div id="cnt-hours" class="serif text-5xl text-white font-light">—</div>
          <div class="text-[#B5924C] text-xs tracking-widest uppercase mt-1">Hours</div>
        </div>
        <div class="serif text-4xl text-[#B5924C] font-light self-start mt-1">:</div>
        <div class="text-center">
          <div id="cnt-mins" class="serif text-5xl text-white font-light">—</div>
          <div class="text-[#B5924C] text-xs tracking-widest uppercase mt-1">Minutes</div>
        </div>
      </div>
      <p class="text-stone-400 text-xs mt-8 animate-fadeup delay-4">Last updated: {datetime.now().strftime("%B %d, %Y at %I:%M %p")}</p>
    </div>
  </header>

  <!-- ── QUICK STATS ─────────────────────────────────────────────────────── -->
  <section class="max-w-6xl mx-auto px-6 py-8 animate-fadeup delay-2">
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="stat-pill text-center">
        <div class="serif text-3xl font-light" style="color: var(--burgundy);">{days_to_go}</div>
        <div class="text-xs text-stone-400 tracking-wider uppercase mt-1">Days to Go</div>
      </div>
      <div class="stat-pill text-center">
        <div class="serif text-3xl font-light" style="color: var(--burgundy);">{booked_count}<span class="text-stone-300 text-xl">/{total_vendors}</span></div>
        <div class="text-xs text-stone-400 tracking-wider uppercase mt-1">Vendors Booked</div>
      </div>
      <div class="stat-pill text-center">
        <div class="serif text-3xl font-light" style="color: var(--burgundy);">₱{total_actual:,.0f}</div>
        <div class="text-xs text-stone-400 tracking-wider uppercase mt-1">Budget Spent</div>
      </div>
      <div class="stat-pill text-center">
        <div class="serif text-3xl font-light" style="color: var(--burgundy);">{guests['total']}</div>
        <div class="text-xs text-stone-400 tracking-wider uppercase mt-1">Guests (est.)</div>
      </div>
    </div>
  </section>

  {overdue_banner}

  <main class="max-w-6xl mx-auto px-6 pb-16 space-y-8">

    <!-- ── TIMELINE & TASKS ───────────────────────────────────────────────── -->
    <section class="section-card overflow-hidden animate-fadeup delay-3">
      <div class="px-6 py-5 border-b border-stone-100">
        <h2 class="serif text-2xl font-light text-stone-800">Planning Timeline</h2>
        <p class="text-stone-400 text-sm mt-0.5">{len(tasks)} milestones &mdash; {sum(1 for t in tasks if t['status'] in ('Booked','Done'))} completed</p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="bg-stone-50 border-b border-stone-100">
              <th class="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">Task</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-stone-400 uppercase tracking-wider">Owner</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-stone-400 uppercase tracking-wider">Status</th>
              <th class="px-4 py-3 text-center text-xs font-semibold text-stone-400 uppercase tracking-wider">Deadline</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-50">
            {timeline_rows}
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── BUDGET ─────────────────────────────────────────────────────────── -->
    <section class="section-card overflow-hidden animate-fadeup delay-4">
      <div class="px-6 py-5 border-b border-stone-100">
        <h2 class="serif text-2xl font-light text-stone-800">Budget Overview</h2>
        <p class="text-stone-400 text-sm mt-0.5">Total committed: <span class="text-emerald-700 font-semibold">₱{total_actual:,.0f}</span></p>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="bg-stone-50 border-b border-stone-100">
              <th class="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">Category</th>
              <th class="px-4 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">Vendor</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-stone-400 uppercase tracking-wider">Actual</th>
              <th class="px-4 py-3 text-right text-xs font-semibold text-stone-400 uppercase tracking-wider">Balance</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-50">
            {budget_rows}
          </tbody>
          <tfoot>
            <tr class="bg-stone-50 border-t border-stone-200">
              <td class="px-4 py-3 text-sm font-semibold text-stone-700" colspan="2">Total Actual Spent</td>
              <td class="px-4 py-3 text-right text-sm font-bold text-emerald-700">₱{total_actual:,.0f}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="px-6 py-5 border-t border-stone-100">
        <h3 class="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-4">Actual Spend by Category</h3>
        <div class="h-64">
          <canvas id="budgetChart"></canvas>
        </div>
      </div>
    </section>

    <!-- ── VENDOR TRACKER ─────────────────────────────────────────────────── -->
    <section class="section-card overflow-hidden animate-fadeup delay-5">
      <div class="px-6 py-5 border-b border-stone-100">
        <h2 class="serif text-2xl font-light text-stone-800">Vendor Tracker</h2>
        <p class="text-stone-400 text-sm mt-0.5">{booked_count} of {total_vendors} vendors confirmed</p>
      </div>
      <div class="p-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {vendor_cards}
      </div>
    </section>

    <!-- ── DAY-OF SCHEDULE ────────────────────────────────────────────────── -->
    <section class="section-card overflow-hidden animate-fadeup delay-6">
      <div class="px-6 py-5 border-b border-stone-100">
        <h2 class="serif text-2xl font-light text-stone-800">Day-of Schedule</h2>
        <p class="text-stone-400 text-sm mt-0.5">December 27, 2026</p>
      </div>
      <div class="p-6">
        {schedule_items}
      </div>
    </section>

    <!-- ── GUEST LIST ──────────────────────────────────────────────────────── -->
    <section class="section-card overflow-hidden animate-fadeup delay-6">
      <div class="px-6 py-5 border-b border-stone-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 class="serif text-2xl font-light text-stone-800">Guest List</h2>
          <p class="text-stone-400 text-sm mt-0.5">
            <span id="guest-count">{len(guests['rows'])}</span> of {len(guests['rows'])} guests &mdash; {guests['total']} pax
          </p>
        </div>
        <a href="reception.html" class="text-xs font-medium px-4 py-2 rounded-full border border-stone-200 text-stone-500 hover:bg-stone-50 transition-colors">
          View Seating Chart →
        </a>
      </div>
      <div class="px-4 py-3 border-b border-stone-100 bg-stone-50 flex flex-wrap gap-2">
        <input type="text" id="guest-search" placeholder="Search by name…"
          class="flex-1 min-w-48 px-3 py-1.5 text-sm border border-stone-200 rounded-lg outline-none focus:border-stone-400 bg-white"
          oninput="applyGuestFilters()" />
        <select id="guest-side" onchange="applyGuestFilters()"
          class="px-3 py-1.5 text-sm border border-stone-200 rounded-lg outline-none focus:border-stone-400 bg-white text-stone-600">
          <option value="">All sides</option>
          <option value="Tommy">Tommy</option>
          <option value="Jeyan">Jeyan</option>
        </select>
        <select id="guest-group" onchange="applyGuestFilters()"
          class="px-3 py-1.5 text-sm border border-stone-200 rounded-lg outline-none focus:border-stone-400 bg-white text-stone-600">
          <option value="">All groups</option>
          {group_options}
        </select>
        <button onclick="clearGuestFilters()"
          class="px-3 py-1.5 text-xs text-stone-400 border border-stone-200 rounded-lg hover:bg-stone-100 bg-white">
          Clear
        </button>
      </div>
      <div class="overflow-x-auto">
        <div style="max-height:520px; overflow-y:auto;">
          <table class="w-full">
            <thead class="sticky top-0 z-10">
              <tr class="bg-stone-50 border-b border-stone-100">
                <th class="px-3 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">Name</th>
                <th class="px-3 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">Group</th>
                <th class="px-3 py-3 text-left text-xs font-semibold text-stone-400 uppercase tracking-wider">Role</th>
                <th class="px-3 py-3 text-center text-xs font-semibold text-stone-400 uppercase tracking-wider">Side</th>
                <th class="px-3 py-3 text-center text-xs font-semibold text-stone-400 uppercase tracking-wider">Pax</th>
                <th class="px-3 py-3 text-center text-xs font-semibold text-stone-400 uppercase tracking-wider">Table</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-stone-50" id="guest-tbody">
              {guest_rows}
            </tbody>
          </table>
        </div>
      </div>
    </section>

  </main>

  <footer class="text-center py-8 text-stone-300 text-xs tracking-wider">
    <span class="serif italic text-stone-400">Tommy &amp; Jeyan &bull; December 27, 2026</span>
  </footer>

  <script>
    // Countdown timer
    function updateCountdown() {{
      const wedding = new Date('2026-12-27T15:00:00+08:00');
      const now     = new Date();
      const diff    = wedding - now;
      if (diff <= 0) {{
        document.getElementById('cnt-days').textContent  = '0';
        document.getElementById('cnt-hours').textContent = '0';
        document.getElementById('cnt-mins').textContent  = '0';
        return;
      }}
      const days  = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const mins  = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      document.getElementById('cnt-days').textContent  = days;
      document.getElementById('cnt-hours').textContent = String(hours).padStart(2, '0');
      document.getElementById('cnt-mins').textContent  = String(mins).padStart(2, '0');
    }}
    updateCountdown();
    setInterval(updateCountdown, 30000);

    // Guest search + filter
    function applyGuestFilters() {{
      const q     = document.getElementById('guest-search').value.toLowerCase();
      const side  = document.getElementById('guest-side').value;
      const group = document.getElementById('guest-group').value;
      const rows  = document.querySelectorAll('#guest-tbody tr');
      let visible = 0;
      rows.forEach(r => {{
        const matchQ = !q     || r.textContent.toLowerCase().includes(q);
        const matchS = !side  || r.dataset.side  === side;
        const matchG = !group || r.dataset.group === group;
        const show   = matchQ && matchS && matchG;
        r.style.display = show ? '' : 'none';
        if (show) visible++;
      }});
      document.getElementById('guest-count').textContent = visible;
    }}
    function clearGuestFilters() {{
      document.getElementById('guest-search').value = '';
      document.getElementById('guest-side').value   = '';
      document.getElementById('guest-group').value  = '';
      applyGuestFilters();
    }}

    // Budget chart
    const ctx = document.getElementById('budgetChart').getContext('2d');
    new Chart(ctx, {{
      type: 'bar',
      data: {{
        labels: {chart_labels_js},
        datasets: [
          {{
            label: 'Actual Spend',
            data: {chart_actual_js},
            backgroundColor: 'rgba(139,26,53,0.25)',
            borderColor: 'rgba(139,26,53,0.7)',
            borderWidth: 1,
            borderRadius: 4,
          }}
        ]
      }},
      options: {{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {{
          legend: {{
            labels: {{ font: {{ family: 'Inter', size: 11 }}, color: '#78716c' }}
          }}
        }},
        scales: {{
          x: {{
            ticks: {{
              font: {{ family: 'Inter', size: 9 }},
              color: '#a8a29e',
              maxRotation: 45,
            }},
            grid: {{ color: '#f5f0eb' }}
          }},
          y: {{
            ticks: {{
              font: {{ family: 'Inter', size: 10 }},
              color: '#a8a29e',
              callback: v => '₱' + (v >= 1000 ? (v/1000).toFixed(0) + 'k' : v)
            }},
            grid: {{ color: '#f5f0eb' }}
          }}
        }}
      }}
    }});
  </script>
</body>
</html>
"""
    return html


# ── Reception / Seating Chart ─────────────────────────────────────────────────

TABLE_META = {
    1:  ("VIP", "#B5924C"),   2:  ("VIP", "#B5924C"),   3:  ("VIP", "#B5924C"),
    4:  ("Jeyan Family", "#D4A5A0"), 5: ("Jeyan Family", "#D4A5A0"), 6: ("Jeyan Family", "#D4A5A0"),
    7:  ("Tommy Family", "#B8837A"), 8: ("Tommy Family", "#B8837A"), 9: ("Tommy Family", "#B8837A"),
    10: ("Jeyan Friends", "#7A9E7E"), 11: ("Jeyan Friends", "#7A9E7E"),
    12: ("Jeyan Friends", "#7A9E7E"), 13: ("Jeyan Friends", "#7A9E7E"),
    14: ("Tommy Friends", "#8B1A35"), 15: ("Tommy Friends", "#8B1A35"), 16: ("Tommy Friends", "#8B1A35"),
}

# Talisay floor plan: 9.8m wide × 33m long (300 sqm)
# SVG viewBox: 420 × 1300.  Scale: 32px/m
# Kitchen: separate external room above hall (not part of 300sqm).
# Hall: x=54–366 (312px = 9.75m), y=132–1160 (1028px = 32.1m), stair notch bottom-right.
# Layout top→bottom: Stage/Backdrop → Sweetheart table → Dance floor → 8 rows of guest tables.
# Buffet strip on RIGHT WALL alongside rows 4–8 (matches seating mockup).
# Left col x=130, right col x=290, row spacing 90px from y=400.
TABLE_POS = {
    1:  (130, 400),   # Row 1 left  — Sponsors
    2:  (290, 400),   # Row 1 right — Sponsors
    3:  (130, 490),   # Row 2 left  — Sponsors
    4:  (290, 490),
    5:  (130, 580),
    6:  (290, 580),
    7:  (130, 670),
    8:  (290, 670),
    9:  (130, 760),
    10: (290, 760),
    11: (130, 850),
    12: (290, 850),
    13: (130, 940),
    14: (290, 940),
    15: (130, 1030),
    16: (290, 1030),
}

def make_floor_plan_svg(option, by_table):
    """Return an SVG string for the Talisay floor plan.
    option='a' → all round tables; option='b' → tables 1-3 as sponsor rectangles.

    Scale: 32px/m.  ViewBox: 0 0 420 1300
    Hall: x=54–366 (312px = 9.75m), y=132–1160 (1028px = 32.1m)
    Top→bottom inside hall:
      Stage/Backdrop (full-width, 2.3m deep)
      Sweetheart table — T&J circle (separate, below stage)
      Dance floor (8.5m × 2.7m, dashed)
      Guest tables T01–T16 (8 rows × 2 cols, r=26, 90px row spacing)
      Buffet strip RIGHT WALL, rows 4–8 (y=665–1057, matches seating mockup)
      Mobile bar + Entrance at bottom
      Stair notch bottom-right
    """
    SPONSOR_TABLES = {1, 2, 3}

    table_svgs = ""
    for tnum, (cx, cy) in TABLE_POS.items():
        _, color = TABLE_META.get(tnum, ("Guest", "#A0A0A0"))
        members   = by_table.get(tnum, [])
        total_pax = sum(g["pax"] for g in members)
        warn      = " ⚠" if total_pax > 10 else ""

        if option == "b" and tnum in SPONSOR_TABLES:
            rw, rh   = 120, 44
            rx_pos   = cx - rw // 2
            ry_pos   = cy - rh // 2
            table_svgs += f'\n  <rect x="{rx_pos}" y="{ry_pos}" width="{rw}" height="{rh}" rx="5" fill="{color}" fill-opacity="0.22" stroke="{color}" stroke-width="1.5"/>'
            table_svgs += f'\n  <text x="{cx}" y="{cy - 5}" text-anchor="middle" font-size="11" font-weight="bold" fill="{color}">{tnum} · {int(total_pax)}pax{warn}</text>'
            table_svgs += f'\n  <text x="{cx}" y="{cy + 10}" text-anchor="middle" font-size="9" fill="{color}" font-style="italic">Sponsors</text>'
        else:
            table_svgs += f'\n  <circle cx="{cx}" cy="{cy}" r="26" fill="{color}" fill-opacity="0.22" stroke="{color}" stroke-width="1.5"/>'
            table_svgs += f'\n  <text x="{cx}" y="{cy - 5}" text-anchor="middle" font-size="11" font-weight="bold" fill="{color}">{tnum}</text>'
            table_svgs += f'\n  <text x="{cx}" y="{cy + 9}" text-anchor="middle" font-size="9" fill="#5A4040">{int(total_pax)}pax{warn}</text>'

    return f"""<svg viewBox="0 0 420 1300" width="380" height="1176" xmlns="http://www.w3.org/2000/svg" class="block">

  <!-- ═══ EXTERNAL KITCHEN — separate room, NOT part of 300sqm hall ═══ -->
  <rect x="54" y="14" width="135" height="118" rx="3" fill="#efe0ce" stroke="#9B7A52" stroke-width="2"/>
  <text x="121" y="56" text-anchor="middle" font-size="11" fill="#6B4820" font-weight="700" letter-spacing="0.5">KITCHEN</text>
  <text x="121" y="72" text-anchor="middle" font-size="9" fill="#9B7A52">separate room</text>
  <text x="121" y="86" text-anchor="middle" font-size="8" fill="#B09070">(not part of main hall)</text>
  <!-- Service door: gap in top wall with swing arc -->
  <line x1="54"  y1="132" x2="76"  y2="132" stroke="#C4B49A" stroke-width="2.5"/>
  <line x1="100" y1="132" x2="366" y2="132" stroke="#C4B49A" stroke-width="2.5"/>
  <path d="M 76,132 A 24,24 0 0 1 100,108" fill="none" stroke="#9B7A52" stroke-width="1.5" stroke-dasharray="3,2"/>
  <text x="88" y="127" text-anchor="middle" font-size="7" fill="#9B7A52">service door</text>

  <!-- ═══ MAIN HALL — 9.75m × 32.1m, stair notch bottom-right ═══ -->
  <polygon points="54,132 366,132 366,1108 316,1160 54,1160" fill="#F9F6F2" stroke="#C4B49A" stroke-width="2"/>

  <!-- ── STAGE / BACKDROP — full-width, top of hall, ~2.3m deep ── -->
  <rect x="62" y="144" width="296" height="74" rx="6"
        fill="#EAD8EC" fill-opacity="0.65" stroke="#A484A8" stroke-width="1.5"/>
  <text x="210" y="176" text-anchor="middle" font-size="12" font-weight="bold" fill="#6A3080" letter-spacing="1">&#9829; STAGE / BACKDROP</text>
  <text x="210" y="193" text-anchor="middle" font-size="8" fill="#9070A0">9.25m &#215; 2.3m</text>

  <!-- ── SWEETHEART TABLE — T&amp;J, small circle below stage ── -->
  <circle cx="210" cy="248" r="22" fill="#8B1A35" fill-opacity="0.15" stroke="#8B1A35" stroke-width="1.8"/>
  <text x="210" y="244" text-anchor="middle" font-size="9" font-weight="bold" fill="#8B1A35">T &amp; J</text>
  <text x="210" y="257" text-anchor="middle" font-size="7" fill="#8B1A35">sweetheart</text>

  <!-- ── DANCE FLOOR — below sweetheart table, ~8.5m × 2.7m ── -->
  <rect x="72" y="278" width="272" height="86" rx="6"
        fill="#fdf6f0" stroke="#D4C5B0" stroke-width="1.5" stroke-dasharray="6,3"/>
  <text x="208" y="318" text-anchor="middle" font-size="11" fill="#B0A090" letter-spacing="2">&#43; DANCE FLOOR</text>
  <text x="208" y="335" text-anchor="middle" font-size="8" fill="#C8B8A0">8.5m &#215; 2.7m</text>

  <!-- ── DJ BOOTH — right corner beside stage ── -->
  <rect x="346" y="144" width="18" height="52" rx="3" fill="#E8D5B5" stroke="#B5924C" stroke-width="1.5"/>
  <text x="355" y="168" text-anchor="middle" font-size="8" fill="#8B6340" font-weight="700" transform="rotate(90,355,168)">DJ</text>

  <!-- ── BUFFET STRIP — RIGHT WALL, rows T04–T16 (y=665–1057) ── -->
  <rect x="346" y="665" width="20" height="392" rx="3"
        fill="#FEFAE8" fill-opacity="0.9" stroke="#C4A840" stroke-width="1.5" stroke-dasharray="5,3"/>
  <text x="356" y="860" text-anchor="middle" font-size="9" fill="#7A6010" font-weight="600" transform="rotate(90,356,860)">BUFFET</text>

  <!-- ── CENTER AISLE ── -->
  <line x1="210" y1="374" x2="210" y2="1062" stroke="#E0D8D0" stroke-width="1" stroke-dasharray="5,5"/>

  <!-- ── GUEST TABLES T01–T16 ── -->
  {table_svgs}

  <!-- ── MOBILE BAR — bottom-left ── -->
  <rect x="57" y="1082" width="74" height="40" rx="5" fill="#E8D5B5" stroke="#B5924C" stroke-width="1.5"/>
  <text x="94" y="1098" text-anchor="middle" font-size="9" fill="#8B6340" font-weight="600">MOBILE</text>
  <text x="94" y="1112" text-anchor="middle" font-size="9" fill="#8B6340">BAR</text>

  <!-- ── ENTRANCE DOORS — bottom-center ── -->
  <rect x="152" y="1098" width="52" height="30" rx="4" fill="#E8E0D5" stroke="#C4B89A" stroke-width="1.2"/>
  <rect x="218" y="1098" width="52" height="30" rx="4" fill="#E8E0D5" stroke="#C4B89A" stroke-width="1.2"/>
  <text x="178" y="1118" text-anchor="middle" font-size="8" fill="#8B7355">DOOR</text>
  <text x="244" y="1118" text-anchor="middle" font-size="8" fill="#8B7355">DOOR</text>
  <text x="210" y="1148" text-anchor="middle" font-size="9" fill="#B0A090" letter-spacing="1.5">&#9650; ENTRANCE</text>

  <!-- ── STAIR NOTCH — bottom-right ── -->
  <polygon points="316,1160 366,1108 366,1160" fill="#DDD4C8" stroke="#C4B89A" stroke-width="1.2"/>
  <text x="343" y="1148" text-anchor="middle" font-size="7" fill="#8B7355" transform="rotate(-45,343,1148)">STAIRS</text>

  <!-- ── DIMENSION LABELS ── -->
  <text x="210" y="11" text-anchor="middle" font-size="8" fill="#B0A090">9.8 m</text>
  <text x="22" y="650" text-anchor="middle" font-size="8" fill="#B0A090" transform="rotate(-90,22,650)">33 m</text>
</svg>"""


def build_reception_html(guests):
    # Group guests by table
    by_table = {}
    unassigned = []
    for g in guests["rows"]:
        if g["table"]:
            by_table.setdefault(g["table"], []).append(g)
        else:
            unassigned.append(g)

    # Build SVG floor plans for both layout options
    svg_a = make_floor_plan_svg("a", by_table)
    svg_b = make_floor_plan_svg("b", by_table)

    # Table cards HTML
    table_cards = ""
    for tnum in sorted(by_table.keys()):
        members  = by_table[tnum]
        cat, color = TABLE_META.get(tnum, ("Guest", "#A0A0A0"))
        total_pax  = sum(g["pax"] for g in members)
        warn_html  = '<span class="ml-1 text-amber-600 font-bold" title="Over 10 pax">⚠</span>' if total_pax > 10 else ""
        names_html = ""
        for g in members:
            role_info = ROLE_BADGE.get(g["role"])
            role_html = f'<span class="ml-1 px-1 py-0.5 rounded text-xs font-medium {role_info[0]}">{role_info[1]}</span>' if role_info else ""
            plus_html = ' <span class="text-xs text-emerald-600">+1</span>' if g["plus1"] == "Yes" else ""
            names_html += f'<li class="flex items-center gap-1 py-0.5 border-b border-stone-50 last:border-0">{g["name"]}{plus_html}{role_html}</li>'
        table_cards += f"""
        <div class="rounded-xl border border-stone-200 overflow-hidden hover:shadow-md transition-shadow">
          <div class="px-4 py-3 flex items-center justify-between" style="background: {color}22; border-bottom: 1px solid {color}44;">
            <div>
              <span class="text-xs font-semibold tracking-widest uppercase text-stone-400">Table {tnum}</span>
              <span class="ml-2 text-xs" style="color:{color};">{cat}</span>
            </div>
            <span class="text-sm font-semibold text-stone-600">{int(total_pax)} pax{warn_html}</span>
          </div>
          <ul class="px-4 py-2 text-sm text-stone-700">{names_html}</ul>
        </div>"""

    # Unassigned section
    unassigned_html = ""
    if unassigned:
        items = "".join(f'<li class="py-0.5 border-b border-stone-50 last:border-0 text-sm text-stone-600">{g["name"]} <span class="text-xs text-stone-400">({g["group"]})</span></li>' for g in unassigned)
        unassigned_html = f"""
        <div class="section-card overflow-hidden mt-8">
          <div class="px-6 py-4 border-b border-stone-100 bg-amber-50">
            <h3 class="serif text-xl font-light text-amber-800">Unassigned ({len(unassigned)} guests)</h3>
            <p class="text-amber-600 text-xs mt-0.5">These guests have not yet been assigned to a table.</p>
          </div>
          <ul class="px-6 py-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6">{items}</ul>
        </div>"""

    from datetime import datetime
    now_str = datetime.now().strftime("%B %d, %Y at %I:%M %p")

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tommy &amp; Jeyan — Reception Seating</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {{ --burgundy: #8B1A35; --gold: #B5924C; --cream: #FAF7F2; }}
    body {{ background-color: var(--cream); font-family: 'Inter', sans-serif; }}
    .serif {{ font-family: 'Cormorant Garamond', Georgia, serif; }}
    .section-card {{ background: white; border: 1px solid #E8E0D5; border-radius: 16px; }}
  </style>
</head>
<body class="min-h-screen">

  <header style="background: linear-gradient(160deg, #2D0A16 0%, #5A1525 50%, #8B1A35 100%);">
    <div class="max-w-7xl mx-auto px-6 py-10 flex items-center justify-between flex-wrap gap-4">
      <div>
        <p class="text-[#B5924C] text-xs tracking-[0.4em] uppercase mb-1">Reception · Talisay Events Hall</p>
        <h1 class="serif text-4xl md:text-5xl text-white font-light italic">Seating Chart</h1>
        <p class="text-stone-400 text-xs mt-2">Tommy &amp; Jeyan &bull; December 27, 2026 &bull; Updated {now_str}</p>
      </div>
      <div class="flex gap-3">
        <a href="floor-plan.html" class="text-xs text-[#B5924C] border border-[#B5924C] px-4 py-2 rounded-full hover:bg-[#B5924C] hover:text-white transition-colors">&#9998; Floor Plan Editor</a>
        <a href="index.html" class="text-xs text-[#B5924C] border border-[#B5924C] px-4 py-2 rounded-full hover:bg-[#B5924C] hover:text-white transition-colors">← Dashboard</a>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-6 py-10">

    <!-- Venue info + legend -->
    <div class="flex flex-wrap gap-4 mb-8 items-start">
      <div class="section-card px-6 py-4 flex-1 min-w-60">
        <p class="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-1">Venue</p>
        <p class="serif text-xl font-light text-stone-800">Gallio Events Hall — Talisay</p>
        <p class="text-stone-400 text-sm">±300 sqm · 9.8m × 33m · {guests['total']} est. pax</p>
      </div>
      <div class="section-card px-6 py-4">
        <p class="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-2">Legend</p>
        <div class="flex flex-wrap gap-3 text-xs">
          <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full inline-block" style="background:#B5924C"></span>VIP / Sponsors</span>
          <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full inline-block" style="background:#D4A5A0"></span>Jeyan's Family</span>
          <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full inline-block" style="background:#B8837A"></span>Tommy's Family</span>
          <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full inline-block" style="background:#7A9E7E"></span>Jeyan's Friends</span>
          <span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full inline-block" style="background:#8B1A35"></span>Tommy's Friends</span>
        </div>
      </div>
    </div>

    <div class="flex flex-col lg:flex-row gap-8">

      <!-- Floor plan SVG with layout options -->
      <div class="section-card p-6 flex-shrink-0">
        <p class="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-3">Floor Plan — Talisay (300 sqm)</p>
        <div class="flex gap-2 mb-4">
          <button id="btn-a" onclick="showOption('a')"
            class="px-3 py-1.5 text-xs font-medium rounded-full border border-[#8B1A35] bg-[#8B1A35] text-white transition-colors">
            Option A &middot; All Round
          </button>
          <button id="btn-b" onclick="showOption('b')"
            class="px-3 py-1.5 text-xs font-medium rounded-full border border-stone-300 text-stone-500 hover:bg-stone-50 transition-colors">
            Option B &middot; Sponsor Tables
          </button>
        </div>
        <div id="svg-a">{svg_a}</div>
        <div id="svg-b" style="display:none">{svg_b}</div>
      </div>

      <!-- Table cards -->
      <div class="flex-1">
        <p class="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-4">Tables &amp; Guests</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {table_cards}
        </div>
        {unassigned_html}
      </div>

    </div>
  </main>

  <footer class="text-center py-8 text-stone-300 text-xs tracking-wider">
    <span class="serif italic text-stone-400">Tommy &amp; Jeyan &bull; December 27, 2026</span>
  </footer>

  <script>
    function showOption(opt) {{
      document.getElementById('svg-a').style.display = opt === 'a' ? '' : 'none';
      document.getElementById('svg-b').style.display = opt === 'b' ? '' : 'none';
      var activeClass = 'bg-[#8B1A35] text-white border-[#8B1A35]';
      var inactiveClass = 'bg-white text-stone-500 border-stone-300 hover:bg-stone-50';
      if (opt === 'a') {{
        document.getElementById('btn-a').className = 'px-3 py-1.5 text-xs font-medium rounded-full border border-[#8B1A35] bg-[#8B1A35] text-white transition-colors';
        document.getElementById('btn-b').className = 'px-3 py-1.5 text-xs font-medium rounded-full border border-stone-300 text-stone-500 hover:bg-stone-50 transition-colors';
      }} else {{
        document.getElementById('btn-a').className = 'px-3 py-1.5 text-xs font-medium rounded-full border border-stone-300 text-stone-500 hover:bg-stone-50 transition-colors';
        document.getElementById('btn-b').className = 'px-3 py-1.5 text-xs font-medium rounded-full border border-[#8B1A35] bg-[#8B1A35] text-white transition-colors';
      }}
    }}
  </script>

</body>
</html>"""
    return html


# ── Interactive Floor Plan Editor ────────────────────────────────────────────

def build_floorplan_html(guests):
    """
    Interactive drag-and-drop floor plan editor.
    Scale: 40px/m  →  Hall 9.8m × 33m = 392 × 1320 px  (x=30–422, y=150–1470)
    Layout: hall SVG centered at top; two panels (table list | detail) below.
    Add table / Delete table supported via JS with localStorage persistence.
    """

    # ── Embed data ───────────────────────────────────────────────────────────
    guest_json = json.dumps([
        {"num": g["num"], "name": g["name"], "pax": g["pax"],
         "table": g["table"], "side": g["side"], "group": g["group"]}
        for g in guests["rows"]
    ], ensure_ascii=False)

    table_meta_json = json.dumps({
        str(t): {"cat": cat, "color": col}
        for t, (cat, col) in TABLE_META.items()
    })

    # Initial table positions at 40px/m
    # Hall: left x=30, right x=422 (9.8m), top y=150, bottom y=1470 (33m)
    # Left col x=130 (2.5m from left), right col x=322 (2.5m from right)
    # Rows start at y=520, spacing 100px (2.5m between centers)
    fp_pos = {
        1: (130, 520), 2: (322, 520),
        3: (130, 620), 4: (322, 620),
        5: (130, 720), 6: (322, 720),
        7: (130, 820), 8: (322, 820),
        9: (130, 920), 10: (322, 920),
       11: (130,1020), 12: (322,1020),
       13: (130,1120), 14: (322,1120),
       15: (130,1220), 16: (322,1220),
    }
    table_pos_json = json.dumps(
        {str(t): {"x": x, "y": y} for t, (x, y) in fp_pos.items()}
    )
    table_meta_with_pos_json = json.dumps({
        str(t): {"cat": cat, "color": col, "x": fp_pos[t][0], "y": fp_pos[t][1]}
        for t, (cat, col) in TABLE_META.items()
    })

    comp_defaults_json = json.dumps({
        "comp-sweetheart": {"x": 226, "y": 290},
        "comp-dancefloor": {"x": 226, "y": 400},
        "comp-dj":         {"x": 410, "y": 218},
        "comp-buffet":     {"x": 413, "y": 960},
        "comp-mobilebar":  {"x": 83,  "y": 1320},
    })

    # ── Grid lines (1 m = 40 px, inside hall bounds) ─────────────────────────
    grid_svg = ""
    for gx in range(70, 422, 40):
        grid_svg += f'<line x1="{gx}" y1="150" x2="{gx}" y2="1470"/>'
    for gy in range(190, 1470, 40):
        grid_svg += f'<line x1="30" y1="{gy}" x2="422" y2="{gy}"/>'

    now_str = datetime.now().strftime("%B %d, %Y at %I:%M %p")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Tommy &amp; Jeyan — Floor Plan Editor</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {{ --burgundy:#8B1A35; --gold:#B5924C; --cream:#FAF7F2; }}
    body {{ background:var(--cream); font-family:'Inter',sans-serif; }}
    .serif {{ font-family:'Cormorant Garamond',Georgia,serif; }}
    .sc {{ background:white; border:1px solid #E8E0D5; border-radius:16px; }}

    .fp-comp {{ cursor:grab; user-select:none; }}
    .fp-comp:hover .fp-body {{ opacity:.82; }}
    .fp-comp.dragging {{ cursor:grabbing; opacity:.7; }}
    .fp-table.sel circle {{
      stroke-width:3 !important;
      filter:drop-shadow(0 0 5px rgba(139,26,53,.6));
    }}
    #fp-grid line {{ stroke:#ddd5cc; stroke-width:.6; pointer-events:none; }}

    .g-row {{ display:flex; align-items:center; gap:6px; padding:5px 2px;
              border-bottom:1px solid #f5f0eb; font-size:12px; }}
    .g-row:last-child {{ border:none; }}
    .g-row select {{ font-size:11px; border:1px solid #e0d8d0; border-radius:6px;
                     padding:2px 4px; background:white; color:#555; cursor:pointer;
                     max-width:140px; }}
    .trow {{ display:flex; align-items:center; gap:6px; padding:5px 4px;
             border-bottom:1px solid #f5f0eb; cursor:pointer; border-radius:6px; }}
    .trow:last-child {{ border:none; }}
    .trow:hover {{ background:#f9f6f2; }}
    .trow.sel {{ background:#fdf2f4; }}
    .btn {{
      display:inline-flex; align-items:center; gap:5px;
      padding:6px 14px; border-radius:999px; font-size:12px;
      border:1px solid #e0d8d0; background:white; color:#555;
      cursor:pointer; transition:background .15s;
    }}
    .btn:hover {{ background:#f5f0eb; }}
    .btn-primary {{ background:#8B1A35; color:white; border-color:#8B1A35; }}
    .btn-primary:hover {{ opacity:.9; background:#8B1A35; }}
    .btn-danger  {{ color:#dc2626; border-color:#fca5a5; }}
    .btn-danger:hover {{ background:#fef2f2; }}
  </style>
</head>
<body class="min-h-screen">

<!-- ── HEADER ─────────────────────────────────────────────────────────────── -->
<header style="background:linear-gradient(160deg,#2D0A16 0%,#5A1525 50%,#8B1A35 100%);">
  <div class="max-w-screen-xl mx-auto px-6 py-8 flex items-center justify-between flex-wrap gap-4">
    <div>
      <p class="text-[#B5924C] text-xs tracking-[.4em] uppercase mb-1">Interactive Editor</p>
      <h1 class="serif text-4xl text-white font-light italic">Floor Plan</h1>
      <p class="text-stone-400 text-xs mt-1">Tommy &amp; Jeyan · Dec 27 2026 · Talisay Events Hall · 9.8 m × 33 m · 40 px/m</p>
    </div>
    <div class="flex gap-3 flex-wrap">
      <a href="reception.html" class="text-xs text-[#B5924C] border border-[#B5924C] px-4 py-2 rounded-full hover:bg-[#B5924C] hover:text-white transition-colors">Seating Chart</a>
      <a href="index.html"     class="text-xs text-[#B5924C] border border-[#B5924C] px-4 py-2 rounded-full hover:bg-[#B5924C] hover:text-white transition-colors">← Dashboard</a>
    </div>
  </div>
</header>

<!-- ── TOOLBAR ────────────────────────────────────────────────────────────── -->
<div class="bg-white border-b border-stone-200 sticky top-0 z-20 shadow-sm">
  <div class="max-w-screen-xl mx-auto px-6 py-2.5 flex flex-wrap gap-4 items-center text-xs">
    <div class="flex items-center gap-1.5 text-stone-500 select-none">
      <svg width="42" height="12">
        <line x1="1" y1="6" x2="41" y2="6" stroke="#999" stroke-width="1.5"/>
        <line x1="1" y1="2" x2="1"  y2="10" stroke="#999" stroke-width="1.5"/>
        <line x1="41" y1="2" x2="41" y2="10" stroke="#999" stroke-width="1.5"/>
      </svg>
      <span class="font-medium">1 m = 40 px</span>
    </div>
    <div class="h-4 w-px bg-stone-200"></div>
    <label class="flex items-center gap-1.5 text-stone-600 cursor-pointer select-none">
      <input type="checkbox" id="snap-cb" checked class="accent-[#8B1A35]"> Snap 50 cm
    </label>
    <label class="flex items-center gap-1.5 text-stone-600 cursor-pointer select-none">
      <input type="checkbox" id="grid-cb" class="accent-[#8B1A35]"> Grid 1 m
    </label>
    <div class="h-4 w-px bg-stone-200"></div>
    <button class="btn" onclick="resetPositions()">Reset positions</button>
    <button class="btn" onclick="resetGuests()">Reset seating</button>
    <button class="btn btn-primary" onclick="doSave()" id="save-btn">Save</button>
    <div class="ml-auto text-stone-400">
      <span id="stat-a">–</span> / {guests['total']} pax seated &nbsp;·&nbsp; {now_str}
    </div>
  </div>
</div>

<!-- ── MAIN ───────────────────────────────────────────────────────────────── -->
<div class="max-w-screen-xl mx-auto px-6 py-6">

  <!-- Floor plan — centered -->
  <div class="flex justify-center mb-6">
    <div class="sc p-5">
      <p class="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-3 text-center">
        Talisay Events Hall · 9.8 m × 33 m · drag any item to reposition
      </p>
      <div style="overflow-y:auto; max-height:78vh; overflow-x:hidden;">
        <svg id="fp-svg" viewBox="0 0 460 1570" width="460"
             xmlns="http://www.w3.org/2000/svg" style="display:block; touch-action:none;">

          <!-- Grid (1 m = 40 px) -->
          <g id="fp-grid" style="display:none">{grid_svg}</g>

          <!-- ── FIXED: Hall background ── -->

          <!-- Kitchen: external separate room -->
          <rect x="30" y="10" width="160" height="120" rx="3"
                fill="#efe0ce" stroke="#9B7A52" stroke-width="2"/>
          <text x="110" y="52"  text-anchor="middle" font-size="11" fill="#6B4820" font-weight="700">KITCHEN</text>
          <text x="110" y="67"  text-anchor="middle" font-size="9"  fill="#9B7A52">separate room</text>
          <text x="110" y="80"  text-anchor="middle" font-size="8"  fill="#B09070">not part of 300 sqm</text>

          <!-- Service door gap + swing arc -->
          <line x1="30"  y1="150" x2="62"  y2="150" stroke="#C4B49A" stroke-width="2.5"/>
          <line x1="94"  y1="150" x2="422" y2="150" stroke="#C4B49A" stroke-width="2.5"/>
          <path d="M 62,150 A 32,32 0 0 1 94,118"
                fill="none" stroke="#9B7A52" stroke-width="1.5" stroke-dasharray="4,2"/>
          <text x="78" y="145" text-anchor="middle" font-size="7" fill="#9B7A52">service door</text>

          <!-- Main hall: 9.8 m × 33 m -->
          <polygon points="30,150 422,150 422,1430 382,1470 30,1470"
                   fill="#F9F6F2" stroke="#C4B49A" stroke-width="2"/>

          <!-- Stage / Backdrop: 9.4 m × 2.0 m, fixed -->
          <rect x="38" y="162" width="376" height="80" rx="6"
                fill="#EAD8EC" fill-opacity=".65" stroke="#A484A8" stroke-width="1.5"/>
          <text x="226" y="198" text-anchor="middle" font-size="12" font-weight="bold"
                fill="#6A3080" letter-spacing="1">&#9829; STAGE / BACKDROP</text>
          <text x="226" y="214" text-anchor="middle" font-size="8" fill="#9070A0">9.4 m × 2.0 m · fixed</text>

          <!-- Stair notch -->
          <polygon points="382,1470 422,1430 422,1470" fill="#DDD4C8" stroke="#C4B89A" stroke-width="1.2"/>
          <text x="408" y="1462" text-anchor="middle" font-size="7" fill="#8B7355"
                transform="rotate(-45,408,1462)">STAIRS</text>

          <!-- Entrance doors -->
          <rect x="152" y="1438" width="64" height="30" rx="4" fill="#E8E0D5" stroke="#C4B89A" stroke-width="1.2"/>
          <rect x="234" y="1438" width="64" height="30" rx="4" fill="#E8E0D5" stroke="#C4B89A" stroke-width="1.2"/>
          <text x="184" y="1457" text-anchor="middle" font-size="8" fill="#8B7355">DOOR</text>
          <text x="266" y="1457" text-anchor="middle" font-size="8" fill="#8B7355">DOOR</text>
          <text x="226" y="1500" text-anchor="middle" font-size="9" fill="#B0A090" letter-spacing="1.5">&#9650; ENTRANCE</text>

          <!-- Dimension labels -->
          <text x="226" y="7"   text-anchor="middle" font-size="8" fill="#B0A090">9.8 m</text>
          <text x="16"  y="810" text-anchor="middle" font-size="8" fill="#B0A090"
                transform="rotate(-90,16,810)">33 m</text>

          <!-- Scale bar (1 m = 40 px) -->
          <line x1="38" y1="1540" x2="78" y2="1540" stroke="#B0A090" stroke-width="2"/>
          <line x1="38" y1="1534" x2="38" y2="1546" stroke="#B0A090" stroke-width="1.5"/>
          <line x1="78" y1="1534" x2="78" y2="1546" stroke="#B0A090" stroke-width="1.5"/>
          <text x="58" y="1558" text-anchor="middle" font-size="9" fill="#B0A090">1 m</text>

          <!-- ── DRAGGABLE FIXTURES ── -->

          <g class="fp-comp" id="comp-sweetheart" transform="translate(226,290)" data-type="sweetheart">
            <circle r="22" fill="#8B1A35" fill-opacity=".18" stroke="#8B1A35" stroke-width="2" class="fp-body"/>
            <text text-anchor="middle" y="-3" font-size="8" font-weight="bold" fill="#8B1A35">T&amp;J</text>
            <text text-anchor="middle" y="9"  font-size="6" fill="#8B1A35">sweetheart</text>
          </g>

          <g class="fp-comp" id="comp-dancefloor" transform="translate(226,400)" data-type="dancefloor">
            <rect x="-170" y="-60" width="340" height="120" rx="6"
                  fill="#fdf6f0" stroke="#D4C5B0" stroke-width="1.5"
                  stroke-dasharray="6,3" class="fp-body"/>
            <text text-anchor="middle" y="-10" font-size="11" fill="#B0A090" letter-spacing="2">+ DANCE FLOOR</text>
            <text text-anchor="middle" y="7"   font-size="8"  fill="#C8B8A0">8.5 m × 3.0 m</text>
            <text text-anchor="middle" y="22"  font-size="7"  fill="#D0C8C0">drag to reposition</text>
          </g>

          <g class="fp-comp" id="comp-dj" transform="translate(410,218)" data-type="dj">
            <rect x="-12" y="-32" width="24" height="64" rx="3"
                  fill="#E8D5B5" stroke="#B5924C" stroke-width="1.5" class="fp-body"/>
            <text text-anchor="middle" y="-6" font-size="8" font-weight="700" fill="#8B6340">DJ</text>
            <text text-anchor="middle" y="6"  font-size="6"                   fill="#A88050">booth</text>
          </g>

          <g class="fp-comp" id="comp-buffet" transform="translate(413,960)" data-type="buffet">
            <rect x="-15" y="-120" width="30" height="240" rx="3"
                  fill="#FEFAE8" fill-opacity=".92" stroke="#C4A840"
                  stroke-width="1.5" stroke-dasharray="5,3" class="fp-body"/>
            <text text-anchor="middle" y="5" font-size="9" fill="#7A6010" font-weight="600"
                  transform="rotate(-90,0,5)">BUFFET</text>
          </g>

          <g class="fp-comp" id="comp-mobilebar" transform="translate(83,1320)" data-type="mobilebar">
            <rect x="-46" y="-20" width="92" height="40" rx="5"
                  fill="#E8D5B5" stroke="#B5924C" stroke-width="1.5" class="fp-body"/>
            <text text-anchor="middle" y="-3" font-size="9"  font-weight="600" fill="#8B6340">MOBILE BAR</text>
            <text text-anchor="middle" y="10" font-size="7"                    fill="#B09070">2.3 m × 1.0 m</text>
          </g>

          <!-- ── TABLES (rendered by JS on init) ── -->
          <g id="fp-tables"></g>

        </svg>
      </div>
    </div>
  </div><!-- /floor plan -->

  <!-- ── TWO PANELS BELOW ────────────────────────────────────────────────── -->
  <div class="grid grid-cols-2 gap-6" style="max-width:920px; margin:0 auto;">

    <!-- LEFT: Table list -->
    <div class="sc p-5">
      <div class="flex items-center justify-between mb-3">
        <p class="text-xs font-semibold text-stone-400 uppercase tracking-widest">Tables</p>
        <button class="btn btn-primary" onclick="addTable()">+ Add table</button>
      </div>
      <div class="text-xs text-stone-400 mb-3">
        <span id="stat-a2">–</span> / {guests['total']} pax seated
      </div>
      <div id="table-list"></div>
    </div>

    <!-- RIGHT: Selected table detail -->
    <div class="sc p-5">
      <div id="detail-empty" class="text-stone-300 italic text-sm py-8 text-center">
        Click a table on the floor plan<br>or in the list to see its guests
      </div>
      <div id="detail-content" style="display:none">
        <div class="flex items-start justify-between mb-3">
          <div>
            <p id="d-title" class="text-xs font-semibold text-stone-400 uppercase tracking-widest"></p>
            <p id="d-cat"   class="text-sm text-stone-600 mt-0.5"></p>
          </div>
          <div id="d-pax" class="serif text-2xl font-light" style="color:var(--burgundy)"></div>
        </div>
        <ul id="d-guests" class="mb-4 divide-y divide-stone-50"></ul>
        <div class="flex gap-2 flex-wrap pt-2 border-t border-stone-100">
          <p class="text-xs text-stone-300 flex-1 self-center">Changes auto-save to browser</p>
          <button class="btn btn-danger" onclick="deleteTable()">&#128465; Delete table</button>
        </div>
      </div>
    </div>

  </div><!-- /panels -->

</div><!-- /main -->

<footer class="text-center py-6 text-stone-300 text-xs tracking-wider mt-6">
  <span class="serif italic text-stone-400">Tommy &amp; Jeyan &bull; December 27, 2026</span>
</footer>

<script>
// ── EMBEDDED DATA ─────────────────────────────────────────────────────────────
const GUESTS          = {guest_json};
const DEFAULT_META    = {table_meta_with_pos_json};
const DEFAULT_COMPS   = {comp_defaults_json};

// ── MUTABLE STATE ─────────────────────────────────────────────────────────────
let tables      = {{}};   // tableNum → {{cat, color, x, y}}
let assignments = {{}};   // guestNum → tableNum | null
let selTable    = null;
let snapOn      = true;
const SNAP = 20;          // 20 px = 50 cm
const LS_T  = 'tjwed_tables';
const LS_A  = 'tjwed_asn';
const LS_FX = 'tjwed_fixtures';

// ── INIT ──────────────────────────────────────────────────────────────────────
function init() {{
  // Default assignments from server data
  GUESTS.forEach(g => {{ assignments[g.num] = g.table || null; }});

  // Load saved assignments
  try {{ const a = localStorage.getItem(LS_A); if (a) Object.assign(assignments, JSON.parse(a)); }} catch(_) {{}}

  // Load tables (or use defaults)
  const savedT = localStorage.getItem(LS_T);
  if (savedT) {{
    try {{ tables = JSON.parse(savedT); }} catch(_) {{ tables = {{...DEFAULT_META}}; }}
  }} else {{
    tables = {{...DEFAULT_META}};
  }}

  // Render all table SVG elements
  Object.entries(tables).forEach(([t, meta]) => createTableSVG(+t, meta.x, meta.y, meta.color));

  // Restore fixture positions
  try {{
    const fx = localStorage.getItem(LS_FX);
    if (fx) {{
      const pos = JSON.parse(fx);
      Object.entries(pos).forEach(([id, {{x,y}}]) => {{
        const el = document.getElementById(id);
        if (el) el.setAttribute('transform', `translate(${{x}},${{y}})`);
      }});
    }}
  }} catch(_) {{}}

  setupDrag();
  setupToggles();
  renderAll();
}}

// ── SVG TABLE CREATION ────────────────────────────────────────────────────────
function createTableSVG(tNum, cx, cy, color) {{
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'fp-comp fp-table');
  g.setAttribute('id', `fp-t${{tNum}}`);
  g.setAttribute('transform', `translate(${{cx}},${{cy}})`);
  g.dataset.table = tNum;

  g.innerHTML = `
    <circle r="30" fill="${{color}}" fill-opacity=".20"
            stroke="${{color}}" stroke-width="1.5" class="fp-body"/>
    <text text-anchor="middle" y="-5" font-size="12"
          font-weight="bold" fill="${{color}}">${{tNum}}</text>
    <text id="fp-px${{tNum}}" text-anchor="middle" y="9"
          font-size="9" fill="#5A4040">–pax</text>`;

  document.getElementById('fp-tables').appendChild(g);
}}

// ── DRAG & DROP ───────────────────────────────────────────────────────────────
function svgPt(e) {{
  const svg = document.getElementById('fp-svg');
  const p   = svg.createSVGPoint();
  const src = e.touches ? e.touches[0] : e;
  p.x = src.clientX; p.y = src.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());
}}

function getTr(el) {{
  const m = (el.getAttribute('transform') || 'translate(0,0)')
              .match(/translate\(([^,]+),([^)]+)\)/);
  return m ? {{x:+m[1], y:+m[2]}} : {{x:0,y:0}};
}}

function snapV(v) {{ return snapOn ? Math.round(v/SNAP)*SNAP : v; }}

function setupDrag() {{
  const svg = document.getElementById('fp-svg');
  let drag=null, off={{x:0,y:0}}, moved=false;

  svg.addEventListener('mousedown', e => {{
    const comp = e.target.closest('.fp-comp');
    if (!comp) return;
    e.preventDefault();
    drag=comp; moved=false;
    comp.classList.add('dragging');
    comp.parentNode.appendChild(comp);
    const pt=svgPt(e), tr=getTr(comp);
    off={{x:pt.x-tr.x, y:pt.y-tr.y}};
  }});

  svg.addEventListener('mousemove', e => {{
    if (!drag) return;
    moved=true;
    const pt=svgPt(e);
    drag.setAttribute('transform',
      `translate(${{snapV(pt.x-off.x)}},${{snapV(pt.y-off.y)}})`);
  }});

  function end() {{
    if (!drag) return;
    drag.classList.remove('dragging');
    if (!moved && drag.classList.contains('fp-table'))
      selectTable(+drag.dataset.table);
    saveAll();
    drag=null;
  }}
  svg.addEventListener('mouseup', end);
  svg.addEventListener('mouseleave', end);
}}

// ── SAVE / RESET ──────────────────────────────────────────────────────────────
function saveAll() {{
  // Save fixture positions
  const fx={{}};
  document.querySelectorAll('#fp-svg .fp-comp:not(.fp-table)').forEach(el => {{
    const tr=getTr(el); fx[el.id]={{x:tr.x,y:tr.y}};
  }});
  localStorage.setItem(LS_FX, JSON.stringify(fx));

  // Save table state (position + meta)
  const ts={{}};
  Object.keys(tables).forEach(t => {{
    const el=document.getElementById(`fp-t${{t}}`);
    const tr=el?getTr(el):{{x:tables[t].x,y:tables[t].y}};
    ts[t]={{...tables[t], x:tr.x, y:tr.y}};
  }});
  localStorage.setItem(LS_T, JSON.stringify(ts));

  // Save assignments
  localStorage.setItem(LS_A, JSON.stringify(assignments));
}}

function doSave() {{
  saveAll();
  const btn=document.getElementById('save-btn');
  btn.textContent='Saved ✓';
  setTimeout(()=>btn.textContent='Save', 1800);
}}

function resetPositions() {{
  if (!confirm('Reset all positions to defaults?')) return;
  localStorage.removeItem(LS_FX);
  localStorage.removeItem(LS_T);

  // Remove current tables, re-create from defaults
  document.getElementById('fp-tables').innerHTML='';
  tables={{...DEFAULT_META}};
  Object.entries(tables).forEach(([t,m])=>createTableSVG(+t,m.x,m.y,m.color));

  // Reset fixture positions
  Object.entries(DEFAULT_COMPS).forEach(([id,{{x,y}}])=>{{
    const el=document.getElementById(id);
    if(el) el.setAttribute('transform',`translate(${{x}},${{y}})`);
  }});
  renderAll();
}}

function resetGuests() {{
  if (!confirm('Reset all seating to Google Sheets data?')) return;
  localStorage.removeItem(LS_A);
  GUESTS.forEach(g=>{{ assignments[g.num]=g.table||null; }});
  renderAll();
  if (selTable) renderDetail(selTable);
}}

// ── ADD / DELETE TABLE ────────────────────────────────────────────────────────
function addTable() {{
  const nums = Object.keys(tables).map(Number);
  const newNum = nums.length ? Math.max(...nums)+1 : 1;
  const color = '#9CA3AF';
  // Place at center of hall
  const cx=226, cy=810;
  tables[newNum] = {{cat:'Custom', color, x:cx, y:cy}};
  createTableSVG(newNum, cx, cy, color);
  saveAll();
  renderAll();
  selectTable(newNum);
}}

function deleteTable() {{
  if (!selTable) return;
  if (!confirm(`Delete Table ${{selTable}} and unassign all its guests?`)) return;
  // Unassign guests
  GUESTS.forEach(g=>{{ if(assignments[g.num]===selTable) assignments[g.num]=null; }});
  // Remove SVG
  const el=document.getElementById(`fp-t${{selTable}}`);
  if (el) el.remove();
  // Remove from state
  delete tables[selTable];
  selTable=null;
  saveAll();
  document.getElementById('detail-content').style.display='none';
  document.getElementById('detail-empty').style.display='';
  renderAll();
}}

// ── TABLE SELECTION ───────────────────────────────────────────────────────────
function selectTable(tNum) {{
  document.querySelectorAll('.fp-table.sel').forEach(el=>el.classList.remove('sel'));
  document.querySelectorAll('.trow.sel').forEach(el=>el.classList.remove('sel'));

  if (selTable===tNum) {{
    selTable=null;
    document.getElementById('detail-content').style.display='none';
    document.getElementById('detail-empty').style.display='';
    return;
  }}
  selTable=tNum;
  const svgEl=document.getElementById(`fp-t${{tNum}}`);
  if (svgEl) {{ svgEl.classList.add('sel'); svgEl.parentNode.appendChild(svgEl); }}
  const rowEl=document.getElementById(`trow-${{tNum}}`);
  if (rowEl) rowEl.classList.add('sel');

  renderDetail(tNum);
}}

function renderDetail(tNum) {{
  document.getElementById('detail-empty').style.display='none';
  document.getElementById('detail-content').style.display='';

  const meta  = tables[String(tNum)] || tables[tNum] || {{cat:'Guest',color:'#A0A0A0'}};
  const gs    = GUESTS.filter(g=>assignments[g.num]===tNum);
  const pax   = gs.reduce((s,g)=>s+g.pax,0);
  const overLimit = pax>10;

  document.getElementById('d-title').textContent=`Table ${{tNum}}`;
  document.getElementById('d-cat').innerHTML=
    `<span style="color:${{meta.color}};font-size:16px">&#9679;</span> ${{meta.cat}}`;
  document.getElementById('d-pax').textContent=pax+' pax';
  document.getElementById('d-pax').style.color=overLimit?'#dc2626':'#8B1A35';

  // Table options for move dropdown
  const tOpts=Object.keys(tables).map(t=>
    `<option value="${{t}}"${{+t===tNum?' selected':''}}>T${{t}} — ${{(tables[t]||{{}}).cat||'?'}}</option>`
  ).join('');
  const noneOpt=`<option value="">— unassign —</option>`;

  const ul=document.getElementById('d-guests');
  if (!gs.length) {{
    ul.innerHTML='<li class="g-row text-stone-300 italic">No guests assigned</li>';
  }} else {{
    ul.innerHTML=gs.map(g=>`
      <li class="g-row">
        <span class="flex-1 text-stone-700">
          ${{g.name}}${{g.pax>1?`<span class="text-stone-400 text-xs ml-1">+${{g.pax-1}}</span>`:''}}
        </span>
        <span class="text-stone-400 text-xs">${{g.side}}</span>
        <select onchange="moveGuest(${{g.num}},this.value)">
          ${{noneOpt}}${{tOpts}}
        </select>
      </li>`).join('');
    // Set correct selected option
    gs.forEach((g,i)=>{{
      const sel=ul.querySelectorAll('select')[i];
      if(sel) sel.value=String(tNum);
    }});
  }}

  if(overLimit) {{
    ul.insertAdjacentHTML('beforeend',
      `<li class="g-row" style="color:#dc2626;font-size:11px">
         ⚠ Over 10 pax — consider splitting this table
       </li>`);
  }}
}}

// ── GUEST ASSIGNMENT ──────────────────────────────────────────────────────────
function moveGuest(gNum,newTable) {{
  assignments[gNum]=newTable?+newTable:null;
  saveAll();
  renderAll();
  if(selTable) renderDetail(selTable);
}}

// ── RENDER ────────────────────────────────────────────────────────────────────
function renderAll() {{
  updatePaxLabels();
  renderTableList();
  updateStats();
}}

function updatePaxLabels() {{
  const byT={{}};
  GUESTS.forEach(g=>{{
    if(assignments[g.num]) byT[assignments[g.num]]=(byT[assignments[g.num]]||0)+g.pax;
  }});
  Object.keys(tables).forEach(t=>{{
    const el=document.getElementById(`fp-px${{t}}`);
    if(!el) return;
    const p=byT[t]||0;
    el.textContent=p+'pax'+(p>10?' ⚠':'');
    el.setAttribute('fill',p>10?'#dc2626':'#5A4040');
  }});
}}

function renderTableList() {{
  const byT={{}};
  GUESTS.forEach(g=>{{
    if(assignments[g.num]){{
      byT[assignments[g.num]]=byT[assignments[g.num]]||[];
      byT[assignments[g.num]].push(g);
    }}
  }});

  // Unassigned guests at bottom
  const ua=GUESTS.filter(g=>!assignments[g.num]);

  const nums=Object.keys(tables).map(Number).sort((a,b)=>a-b);
  let html=nums.map(t=>{{
    const meta=tables[t]||{{}};
    const pax=(byT[t]||[]).reduce((s,g)=>s+g.pax,0);
    const warn=pax>10?'<span style="color:#dc2626"> ⚠</span>':'';
    const selCls=selTable===t?' sel':'';
    return `<div class="trow${{selCls}}" id="trow-${{t}}" onclick="selectTable(${{t}})">
      <span class="w-3 h-3 rounded-full flex-shrink-0"
            style="background:${{meta.color||'#ccc'}}"></span>
      <span style="font-size:12px;color:#78716c;width:52px">T${{t}}</span>
      <span style="font-size:12px;color:#a8a29e;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${{meta.cat||''}}</span>
      <span style="font-size:12px;font-weight:600;color:#57534e">${{pax}}p${{warn}}</span>
    </div>`;
  }}).join('');

  if(ua.length) {{
    html+=`<div style="margin-top:10px;padding-top:8px;border-top:1px solid #f0ebe4">
      <p style="font-size:11px;color:#f59e0b;font-weight:600;margin-bottom:4px">
        Unassigned (${{ua.length}} guests)
      </p>
      ${{ua.map(g=>`<div class="trow" style="opacity:.7">
        <span style="font-size:12px;color:#78716c;flex:1">${{g.name}}</span>
        <select onchange="moveGuest(${{g.num}},this.value)" style="font-size:11px">
          <option value="">Assign to…</option>
          ${{nums.map(t=>`<option value="${{t}}">T${{t}}</option>`).join('')}}
        </select>
      </div>`).join('')}}
    </div>`;
  }}

  document.getElementById('table-list').innerHTML=html;
}}

function updateStats() {{
  const a=GUESTS.filter(g=>assignments[g.num]).reduce((s,g)=>s+g.pax,0);
  document.getElementById('stat-a').textContent=a;
  document.getElementById('stat-a2').textContent=a;
}}

// ── TOGGLES ───────────────────────────────────────────────────────────────────
function setupToggles() {{
  document.getElementById('snap-cb').addEventListener('change',e=>snapOn=e.target.checked);
  document.getElementById('grid-cb').addEventListener('change',e=>{{
    document.getElementById('fp-grid').style.display=e.target.checked?'':'none';
  }});
}}

// ── BOOT ──────────────────────────────────────────────────────────────────────
init();
</script>
</body>
</html>"""


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("Downloading workbook from Drive...")
    wb = download_workbook()

    print("Reading sheets...")
    tasks    = read_timeline(wb)
    budget   = read_budget(wb)
    vendors  = read_vendors(wb)
    schedule = read_schedule(wb)
    guests   = read_guests(wb)

    print(f"  Timeline : {len(tasks)} tasks")
    print(f"  Budget   : {len(budget)} categories")
    print(f"  Vendors  : {len(vendors)} vendors")
    print(f"  Schedule : {len(schedule)} items")
    print(f"  Guests   : {guests['total']} total pax, {len(guests['rows'])} names")

    print("Generating HTML...")
    dashboard_html  = build_html(tasks, budget, vendors, schedule, guests)
    reception_html  = build_reception_html(guests)
    floorplan_html  = build_floorplan_html(guests)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(dashboard_html)

    reception_path = os.path.join(os.path.dirname(OUTPUT_PATH), "reception.html")
    with open(reception_path, "w", encoding="utf-8") as f:
        f.write(reception_html)

    floorplan_path = os.path.join(os.path.dirname(OUTPUT_PATH), "floor-plan.html")
    with open(floorplan_path, "w", encoding="utf-8") as f:
        f.write(floorplan_html)

    print(f"Done -> {os.path.abspath(OUTPUT_PATH)}")
    print(f"Done -> {os.path.abspath(reception_path)}")
    print(f"Done -> {os.path.abspath(floorplan_path)}")


if __name__ == "__main__":
    main()
