/**
 * ============================================================================
 * ARKAN KONTER — LOGIKA UTAMA APLIKASI KASIR & PEMBUKUAN OFFLINE
 * ============================================================================
 * Fitur Utama:
 * - UI Gabungan Dashboard Modern + Statistik 3 Kolom + Bottom Nav 4 Menu
 * - Tombol Pintas "000" pada input nominal (misal: ketik 10 + tekan 000 -> 10.000)
 * - Skema Biaya Admin Berjenjang Otomatis (<20rb: 3rb, 20-120rb: 5rb, 120rb+: 10rb, 300rb+: 15rb)
 * - Edit & Hapus Transaksi (otomatis mengembalikan/menyesuaikan saldo & piutang terkait)
 * - Edit & Hapus Saldo Dompet
 * - Logika Kasbon Terakumulasi (1 Orang = 1 Data Utang Aktif)
 * - Fitur Bayar / Cicil Kasbon bertahap dengan riwayat cicilan & status Lunas otomatis
 */

(function () {
  'use strict';

  // State aplikasi di memori
  const state = {
    wallets: [],
    transactions: [],
    debts: [],
    selectedWalletId: 'dana',
    selectedPaymentMethod: 'tunai',
    adminManuallyEdited: false,
    confirmCallback: null
  };

  // ==========================================================================
  // 1. HELPER FORMAT ANGKA, RUPIAH, TANGGAL & SKEMA BIAYA ADMIN
  // ==========================================================================

  /** Mengubah string berformat ribuan ("10.000") menjadi integer murni (10000). */
  function parseRupiahInput(str) {
    if (typeof str === 'number') return Math.round(str);
    const cleaned = String(str || '').replace(/[^0-9]/g, '');
    return cleaned ? parseInt(cleaned, 10) : 0;
  }

  /** Memformat integer menjadi format ribuan Indonesia tanpa simbol ("10.000"). */
  function formatThousands(num) {
    const n = Math.round(Number(num) || 0);
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  /** Memformat integer menjadi tampilan mata uang Rupiah ("Rp 10.000" / "Rp -150.000"). */
  function formatRp(num) {
    const n = Math.round(Number(num) || 0);
    const sign = n < 0 ? '-' : '';
    return `${sign}Rp ${formatThousands(Math.abs(n))}`;
  }

  /** Menghitung biaya admin otomatis berdasarkan nominal top up. */
  function calculateTieredAdminFee(nominal) {
    if (!nominal || nominal <= 0) return 0;
    if (nominal < 20000) return 3000;
    if (nominal <= 120000) return 5000;
    if (nominal < 300000) return 10000;
    return 15000;
  }

  /** Memasang format otomatis + tombol pintas "000" pada pasangan input & tombol. */
  function bindNominalInputWithTripleZero(inputEl, zeroBtnEl, onChangeCallback) {
    if (!inputEl) return;

    inputEl.addEventListener('input', () => {
      const val = parseRupiahInput(inputEl.value);
      inputEl.value = val > 0 ? formatThousands(val) : '';
      if (onChangeCallback) onChangeCallback(val);
    });

    if (zeroBtnEl) {
      zeroBtnEl.addEventListener('click', () => {
        const currentVal = parseRupiahInput(inputEl.value);
        if (currentVal <= 0) {
          inputEl.focus();
          return;
        }
        // Tambahkan tiga nol (x1000) lalu format dengan titik ribuan
        const multiplied = currentVal * 1000;
        inputEl.value = formatThousands(multiplied);
        inputEl.focus();
        if (onChangeCallback) onChangeCallback(multiplied);
      });
    }
  }

  /** Menampilkan notifikasi toast singkat di bagian atas layar. */
  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 2600);
  }

  /** Menghasilkan ID unik berbasis timestamp. */
  function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  /** Format tanggal singkat Indonesia (misal: "26 Nov, 09.30"). */
  function formatDateTimeShort(isoStr) {
    const d = new Date(isoStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const day = d.getDate();
    const mon = months[d.getMonth()];
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${mon}, ${hh}.${mm}`;
  }

  /** Mengecek apakah timestamp termasuk hari ini. */
  function isToday(isoStr) {
    const d = new Date(isoStr);
    const now = new Date();
    return (
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    );
  }

  /** Mengecek apakah timestamp termasuk bulan ini. */
  function isThisMonth(isoStr) {
    const d = new Date(isoStr);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }

  /** Menghitung jadwal kulakan saldo berikutnya (Selasa = 2, Jumat = 5). */
  function getNextRestockSchedule() {
    const now = new Date();
    const day = now.getDay(); // 0=Min .. 6=Sab
    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const fullMonths = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];
    const dateLabel = `${dayNames[day]}, ${now.getDate()} ${fullMonths[now.getMonth()]} ${now.getFullYear()}`;

    // Hitung selisih hari ke Selasa (2) dan Jumat (5) terdekat
    const diffTue = (2 - day + 7) % 7;
    const diffFri = (5 - day + 7) % 7;

    let nextDayName = 'Selasa';
    let daysLeft = diffTue;

    if (diffFri < diffTue) {
      nextDayName = 'Jumat';
      daysLeft = diffFri;
    }

    const chipText = daysLeft === 0 ? 'Hari Ini!' : `${daysLeft} Hari`;
    return { dateLabel, nextDayName, daysLeft, chipText };
  }

  // ==========================================================================
  // 2. PEMUATAN DATA & SINKRONISASI STATE
  // ==========================================================================

  async function refreshAllData() {
    const [wallets, transactions, debts] = await Promise.all([
      window.arkanDB.getAll('wallets'),
      window.arkanDB.getAll('transactions'),
      window.arkanDB.getAll('debts')
    ]);

    state.wallets = wallets.sort((a, b) => (a.order || 99) - (b.order || 99));
    state.transactions = transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    state.debts = debts.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    if (!state.wallets.some((w) => w.id === state.selectedWalletId) && state.wallets.length > 0) {
      state.selectedWalletId = state.wallets[0].id;
    }

    renderAll();
  }

  function renderAll() {
    renderHeaderAndSchedule();
    renderDashboard();
    renderTopUpFormWallets();
    renderKasbonPage();
    renderReportPage();
    renderDataPage();
  }

  // ==========================================================================
  // 3. RENDER BERANDA (DASHBOARD GABUNGAN TERBAIK)
  // ==========================================================================

  function renderHeaderAndSchedule() {
    const sched = getNextRestockSchedule();
    document.getElementById('current-date-display').textContent = sched.dateLabel;
    document.getElementById('schedule-countdown-chip').textContent = sched.chipText;

    const unpaidDebts = state.debts.filter((d) => d.status === 'unpaid' && d.remainingAmount > 0);
    const totalUnpaid = unpaidDebts.reduce((sum, d) => sum + d.remainingAmount, 0);

    const bannerSub = document.getElementById('schedule-banner-sub');
    const dataNote = document.getElementById('data-schedule-note');
    if (unpaidDebts.length > 0) {
      const msg = `Berikutnya: ${sched.nextDayName} • Ada ${unpaidDebts.length} kasbon aktif (${formatRp(totalUnpaid)}).`;
      bannerSub.textContent = msg;
      dataNote.textContent = msg;
    } else {
      const msg = `Berikutnya: ${sched.nextDayName} • Tidak ada piutang tertunggak. Arus kas sehat.`;
      bannerSub.textContent = msg;
      dataNote.textContent = msg;
    }

    // Status koneksi offline/online
    const badge = document.getElementById('offline-badge');
    const statusText = document.getElementById('offline-status-text');
    if (navigator.onLine) {
      badge.classList.remove('is-offline');
      statusText.textContent = 'Offline Ready';
    } else {
      badge.classList.add('is-offline');
      statusText.textContent = 'Mode Offline Aktif';
    }
  }

  function renderDashboard() {
    // Saldo Utama (DANA) & Tunai Laci
    const primaryWallet = state.wallets.find((w) => w.isPrimary) || state.wallets[0];
    const cashWallet = state.wallets.find((w) => w.isCash);

    if (primaryWallet) {
      document.getElementById('primary-wallet-name').textContent = primaryWallet.name;
      document.getElementById('primary-wallet-balance').textContent = formatRp(primaryWallet.balance);
    }
    if (cashWallet) {
      document.getElementById('cash-wallet-balance').textContent = formatRp(cashWallet.balance);
    }

    // 3 Kotak Statistik: OMZET HARI INI, UNTUNG BERSIH (HARI INI), TOTAL KASBON AKTIF
    const todayTxs = state.transactions.filter((t) => isToday(t.createdAt));
    const todayTopups = todayTxs.filter((t) => t.type === 'topup');
    const todayExpenses = todayTxs.filter((t) => t.type === 'expense');

    const omzetToday = todayTopups.reduce((sum, t) => sum + (t.nominal || 0), 0);
    const adminProfitToday = todayTopups.reduce((sum, t) => sum + (t.netProfit || 0), 0);
    const expenseToday = todayExpenses.reduce((sum, t) => sum + (t.nominal || 0), 0);
    const netProfitToday = adminProfitToday - expenseToday;

    const totalActiveKasbon = state.debts
      .filter((d) => d.status === 'unpaid')
      .reduce((sum, d) => sum + d.remainingAmount, 0);

    document.getElementById('stat-omzet').textContent = formatRp(omzetToday);
    document.getElementById('stat-profit').textContent = formatRp(netProfitToday);
    document.getElementById('stat-kasbon').textContent = formatRp(totalActiveKasbon);

    // Dot indikator pada bottom nav Kasbon
    const navDot = document.getElementById('nav-kasbon-dot');
    if (totalActiveKasbon > 0) {
      navDot.classList.remove('hidden');
    } else {
      navDot.classList.add('hidden');
    }

    // Grid Dompet Lain & Bank (semua selain primary dan cash)
    const otherWallets = state.wallets.filter((w) => !w.isPrimary && !w.isCash);
    const gridEl = document.getElementById('other-wallets-grid');
    gridEl.innerHTML = otherWallets
      .map(
        (w) => `
        <div class="wallet-mini-card">
          <div>
            <span class="wm-name">${escapeHtml(w.name)}</span>
            <strong class="wm-bal">${formatRp(w.balance)}</strong>
          </div>
          <button type="button" class="icon-btn-tiny" data-edit-wallet="${w.id}" title="Edit Saldo ${escapeHtml(w.name)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
        </div>
      `
      )
      .join('');

    // Aktivitas Terakhir (5 transaksi terbaru + tombol Edit & Hapus)
    const recentListEl = document.getElementById('recent-transactions-list');
    const recentSlice = state.transactions.slice(0, 5);
    if (recentSlice.length === 0) {
      recentListEl.innerHTML = '<div class="empty-state">Belum ada transaksi.</div>';
    } else {
      recentListEl.innerHTML = recentSlice.map((t) => renderTransactionItemHTML(t)).join('');
    }
  }

  /** Membuat HTML satu baris transaksi dengan tombol Edit (pensil) & Hapus (tempat sampah). */
  function renderTransactionItemHTML(tx) {
    const wallet = state.wallets.find((w) => w.id === tx.walletId);
    const walletLabel = wallet ? wallet.shortName : tx.walletName || 'Akun';

    let badgeHTML = '';
    let titleText = '';
    let amountClass = '';
    let amountDisplay = '';
    let subAdminHTML = '';

    if (tx.type === 'topup') {
      const methodLabel =
        tx.paymentMethod === 'kasbon'
          ? 'Kasbon'
          : tx.paymentMethod === 'transfer'
          ? 'Transfer'
          : 'Tunai';
      const badgeCls =
        tx.paymentMethod === 'kasbon'
          ? 'badge-kasbon'
          : tx.paymentMethod === 'transfer'
          ? 'badge-transfer'
          : 'badge-tunai';

      badgeHTML = `<span class="badge-pill ${badgeCls}">${methodLabel}</span>`;
      const custPart = tx.customerName ? ` (${escapeHtml(tx.customerName)})` : '';
      titleText = `Top Up ${escapeHtml(walletLabel)}${custPart}`;
      amountDisplay = formatRp(tx.totalBill);
      subAdminHTML = `<span class="tx-admin-sub">+Admin ${formatRp(tx.adminFee)}</span>`;
    } else if (tx.type === 'expense') {
      badgeHTML = `<span class="badge-pill badge-expense">Pengeluaran</span>`;
      titleText = escapeHtml(tx.note || 'Pengeluaran Operasional');
      amountClass = 'text-red';
      amountDisplay = `-${formatRp(tx.nominal)}`;
    } else if (tx.type === 'income') {
      badgeHTML = `<span class="badge-pill badge-tunai">Pemasukan</span>`;
      titleText = escapeHtml(tx.note || 'Pemasukan / Tambah Modal');
      amountClass = 'text-green';
      amountDisplay = `+${formatRp(tx.nominal)}`;
    } else if (tx.type === 'installment') {
      badgeHTML = `<span class="badge-pill badge-lunas">Cicilan Kasbon</span>`;
      titleText = `Bayar Kasbon (${escapeHtml(tx.customerName || '-')})`;
      amountClass = 'text-green';
      amountDisplay = `+${formatRp(tx.nominal)}`;
    }

    const notePart = tx.type === 'topup' && tx.note ? ` • ${escapeHtml(tx.note)}` : '';
    const canEdit = tx.type !== 'installment';

    return `
      <div class="tx-item">
        <div class="tx-main-info">
          <div class="tx-title-row">
            <span class="tx-title">${titleText}</span>
            ${badgeHTML}
          </div>
          <div class="tx-meta">${formatDateTimeShort(tx.createdAt)} • ${escapeHtml(walletLabel)}${notePart}</div>
        </div>
        <div class="tx-right">
          <span class="tx-amount ${amountClass}">${amountDisplay}</span>
          ${subAdminHTML}
          <div class="tx-actions">
            ${
              canEdit
                ? `<button type="button" class="icon-btn-tiny" data-edit-tx="${tx.id}" title="Edit Transaksi">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  </button>`
                : ''
            }
            <button type="button" class="icon-btn-tiny danger" data-delete-tx="${tx.id}" title="Hapus Transaksi">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ==========================================================================
  // 4. FORM TRANSAKSI TOP UP & KALKULASI REAL-TIME
  // ==========================================================================

  function renderTopUpFormWallets() {
    const digitalWallets = state.wallets.filter((w) => !w.isCash);
    if (!digitalWallets.some((w) => w.id === state.selectedWalletId) && digitalWallets.length > 0) {
      state.selectedWalletId = digitalWallets[0].id;
    }

    const container = document.getElementById('topup-wallet-selector');
    container.innerHTML = digitalWallets
      .map(
        (w) => `
        <button
          type="button"
          class="wallet-pill-opt ${w.id === state.selectedWalletId ? 'active' : ''}"
          data-select-wallet="${w.id}"
        >
          ${escapeHtml(w.shortName)}
        </button>
      `
      )
      .join('');

    const activeWallet = digitalWallets.find((w) => w.id === state.selectedWalletId);
    document.getElementById('selected-wallet-sisa').textContent = `Sisa: ${formatRp(
      activeWallet ? activeWallet.balance : 0
    )}`;
  }

  function updateTopUpCalculation(forceAutoAdmin = false) {
    const nominal = parseRupiahInput(document.getElementById('topup-nominal').value);
    const adminInput = document.getElementById('topup-admin');
    const modalInput = document.getElementById('topup-modal');

    if (forceAutoAdmin || !state.adminManuallyEdited) {
      const autoAdmin = calculateTieredAdminFee(nominal);
      adminInput.value = autoAdmin > 0 ? formatThousands(autoAdmin) : '0';
    }

    const adminFee = parseRupiahInput(adminInput.value);
    // Default potongan modal = nominal top up
    modalInput.value = nominal > 0 ? formatThousands(nominal) : '0';
    const modalDeducted = parseRupiahInput(modalInput.value);

    const totalBill = nominal + adminFee;
    const netProfit = totalBill - modalDeducted;

    document.getElementById('summary-total-bill').textContent = formatRp(totalBill);
    document.getElementById('summary-net-profit').textContent = formatRp(netProfit);
  }

  async function handleTopUpSubmit(e) {
    e.preventDefault();

    const nominal = parseRupiahInput(document.getElementById('topup-nominal').value);
    const adminFee = parseRupiahInput(document.getElementById('topup-admin').value);
    const modalDeducted = parseRupiahInput(document.getElementById('topup-modal').value);
    const note = document.getElementById('topup-note').value.trim();
    const customerName = document.getElementById('topup-customer-name').value.trim();

    if (nominal <= 0) {
      showToast('Masukkan nominal top up terlebih dahulu.');
      document.getElementById('topup-nominal').focus();
      return;
    }

    if (state.selectedPaymentMethod === 'kasbon' && !customerName) {
      showToast('Nama pelanggan wajib diisi untuk transaksi Kasbon!');
      document.getElementById('topup-customer-name').focus();
      return;
    }

    const totalBill = nominal + adminFee;
    const netProfit = totalBill - modalDeducted;
    const nowIso = new Date().toISOString();
    const txId = generateId('tx');

    const sourceWallet = await window.arkanDB.getById('wallets', state.selectedWalletId);
    if (!sourceWallet) {
      showToast('Dompet sumber tidak ditemukan.');
      return;
    }

    // 1. Potong saldo dompet e-wallet sumber
    sourceWallet.balance -= modalDeducted;
    await window.arkanDB.put('wallets', sourceWallet);

    // 2. Proses pembayaran pelanggan (Tunai / Transfer / Kasbon)
    let debtId = null;
    if (state.selectedPaymentMethod === 'tunai') {
      const cashWallet = await window.arkanDB.getById('wallets', 'cash');
      if (cashWallet) {
        cashWallet.balance += totalBill;
        await window.arkanDB.put('wallets', cashWallet);
      }
    } else if (state.selectedPaymentMethod === 'transfer') {
      const bankWallet =
        (await window.arkanDB.getById('wallets', 'bank')) ||
        state.wallets.find((w) => !w.isCash && w.id !== sourceWallet.id);
      if (bankWallet) {
        bankWallet.balance += totalBill;
        await window.arkanDB.put('wallets', bankWallet);
      }
    } else if (state.selectedPaymentMethod === 'kasbon') {
      // LOGIKA KASBON: 1 ORANG = 1 AKUMULASI UTANG AKTIF
      const customerKey = customerName.toLowerCase();
      const allDebts = await window.arkanDB.getAll('debts');
      let existingDebt = allDebts.find((d) => d.customerKey === customerKey && d.status === 'unpaid');

      const historyEntry = {
        id: generateId('dh'),
        type: 'tambah_utang',
        amount: totalBill,
        nominal,
        adminFee,
        walletName: sourceWallet.shortName,
        note,
        date: nowIso,
        txId
      };

      if (existingDebt) {
        // Akumulasikan ke data pelanggan yang sudah ada
        existingDebt.customerName = customerName;
        existingDebt.totalDebt += totalBill;
        existingDebt.remainingAmount += totalBill;
        existingDebt.totalAdmin = (existingDebt.totalAdmin || 0) + adminFee;
        existingDebt.updatedAt = nowIso;
        existingDebt.history = existingDebt.history || [];
        existingDebt.history.push(historyEntry);
        await window.arkanDB.put('debts', existingDebt);
        debtId = existingDebt.id;
      } else {
        // Buat data utang baru untuk pelanggan ini
        debtId = generateId('debt');
        const newDebt = {
          id: debtId,
          customerKey,
          customerName,
          totalDebt: totalBill,
          remainingAmount: totalBill,
          paidAmount: 0,
          totalAdmin: adminFee,
          status: 'unpaid',
          createdAt: nowIso,
          updatedAt: nowIso,
          history: [historyEntry]
        };
        await window.arkanDB.put('debts', newDebt);
      }
    }

    // 3. Simpan riwayat transaksi
    const txRecord = {
      id: txId,
      type: 'topup',
      walletId: sourceWallet.id,
      walletName: sourceWallet.shortName,
      nominal,
      adminFee,
      modalDeducted,
      totalBill,
      netProfit,
      paymentMethod: state.selectedPaymentMethod,
      customerName: state.selectedPaymentMethod === 'kasbon' ? customerName : '',
      debtId,
      note,
      createdAt: nowIso
    };
    await window.arkanDB.put('transactions', txRecord);

    // Reset form
    document.getElementById('topup-nominal').value = '';
    document.getElementById('topup-admin').value = '0';
    document.getElementById('topup-modal').value = '0';
    document.getElementById('topup-customer-name').value = '';
    document.getElementById('topup-note').value = '';
    state.adminManuallyEdited = false;
    updateTopUpCalculation(true);

    await refreshAllData();
    showToast(
      state.selectedPaymentMethod === 'kasbon'
        ? `Kasbon ${customerName} ditambahkan (${formatRp(totalBill)})`
        : `Transaksi Top Up ${formatRp(totalBill)} tersimpan!`
    );
    switchView('beranda');
  }

  // ==========================================================================
  // 5. EDIT & HAPUS TRANSAKSI (REVERSI SALDO & PIUTANG OTOMATIS)
  // ==========================================================================

  /** Membalikkan efek saldo & kasbon dari transaksi sebelum diedit atau dihapus. */
  async function revertTransactionEffects(tx) {
    if (tx.type === 'topup') {
      const sourceWallet = await window.arkanDB.getById('wallets', tx.walletId);
      if (sourceWallet) {
        sourceWallet.balance += tx.modalDeducted || tx.nominal;
        await window.arkanDB.put('wallets', sourceWallet);
      }

      if (tx.paymentMethod === 'tunai') {
        const cashWallet = await window.arkanDB.getById('wallets', 'cash');
        if (cashWallet) {
          cashWallet.balance -= tx.totalBill;
          await window.arkanDB.put('wallets', cashWallet);
        }
      } else if (tx.paymentMethod === 'transfer') {
        const bankWallet = await window.arkanDB.getById('wallets', 'bank');
        if (bankWallet) {
          bankWallet.balance -= tx.totalBill;
          await window.arkanDB.put('wallets', bankWallet);
        }
      } else if (tx.paymentMethod === 'kasbon' && tx.debtId) {
        const debt = await window.arkanDB.getById('debts', tx.debtId);
        if (debt) {
          debt.totalDebt = Math.max(0, debt.totalDebt - tx.totalBill);
          debt.remainingAmount = Math.max(0, debt.remainingAmount - tx.totalBill);
          debt.totalAdmin = Math.max(0, (debt.totalAdmin || 0) - tx.adminFee);
          debt.history = (debt.history || []).filter((h) => h.txId !== tx.id);
          if (debt.totalDebt === 0 && debt.paidAmount === 0) {
            await window.arkanDB.delete('debts', debt.id);
          } else {
            if (debt.remainingAmount === 0) {
              debt.status = 'paid';
              debt.paidOffAt = new Date().toISOString();
            }
            await window.arkanDB.put('debts', debt);
          }
        }
      }
    } else if (tx.type === 'expense') {
      const wallet = await window.arkanDB.getById('wallets', tx.walletId);
      if (wallet) {
        wallet.balance += tx.nominal;
        await window.arkanDB.put('wallets', wallet);
      }
    } else if (tx.type === 'income') {
      const wallet = await window.arkanDB.getById('wallets', tx.walletId);
      if (wallet) {
        wallet.balance -= tx.nominal;
        await window.arkanDB.put('wallets', wallet);
      }
    } else if (tx.type === 'installment') {
      const wallet = await window.arkanDB.getById('wallets', tx.walletId);
      if (wallet) {
        wallet.balance -= tx.nominal;
        await window.arkanDB.put('wallets', wallet);
      }
      if (tx.debtId) {
        const debt = await window.arkanDB.getById('debts', tx.debtId);
        if (debt) {
          debt.remainingAmount += tx.nominal;
          debt.paidAmount = Math.max(0, debt.paidAmount - tx.nominal);
          debt.status = 'unpaid';
          debt.history = (debt.history || []).filter((h) => h.id !== tx.installmentHistId);
          await window.arkanDB.put('debts', debt);
        }
      }
    }
  }

  function promptDeleteTransaction(txId) {
    const tx = state.transactions.find((t) => t.id === txId);
    if (!tx) return;
    openConfirmModal(
      'Hapus Transaksi?',
      'Saldo dompet dan catatan piutang yang terkait dengan transaksi ini akan otomatis dikembalikan seperti semula.',
      async () => {
        await revertTransactionEffects(tx);
        await window.arkanDB.delete('transactions', txId);
        await refreshAllData();
        showToast('Transaksi dihapus & saldo disesuaikan.');
      }
    );
  }

  function openEditTransactionModal(txId) {
    const tx = state.transactions.find((t) => t.id === txId);
    if (!tx) return;

    document.getElementById('edit-tx-id').value = tx.id;
    const walletSelect = document.getElementById('edit-tx-wallet');
    walletSelect.innerHTML = state.wallets
      .map((w) => `<option value="${w.id}">${escapeHtml(w.name)}</option>`)
      .join('');
    walletSelect.value = tx.walletId;

    document.getElementById('edit-tx-nominal').value = formatThousands(tx.nominal);
    document.getElementById('edit-tx-admin').value = formatThousands(tx.adminFee || 0);
    document.getElementById('edit-tx-method').value = tx.paymentMethod || 'tunai';
    document.getElementById('edit-tx-customer').value = tx.customerName || '';
    document.getElementById('edit-tx-note').value = tx.note || '';

    const isTopup = tx.type === 'topup';
    document.getElementById('edit-tx-admin-wrap').style.display = isTopup ? 'block' : 'none';
    document.getElementById('edit-tx-method-wrap').style.display = isTopup ? 'block' : 'none';
    document.getElementById('edit-tx-customer-wrap').style.display = isTopup ? 'block' : 'none';

    openModal('modal-edit-tx');
  }

  async function handleEditTransactionSubmit(e) {
    e.preventDefault();
    const txId = document.getElementById('edit-tx-id').value;
    const oldTx = await window.arkanDB.getById('transactions', txId);
    if (!oldTx) return;

    const newWalletId = document.getElementById('edit-tx-wallet').value;
    const newNominal = parseRupiahInput(document.getElementById('edit-tx-nominal').value);
    const newAdmin = parseRupiahInput(document.getElementById('edit-tx-admin').value);
    const newMethod = document.getElementById('edit-tx-method').value;
    const newCustomer = document.getElementById('edit-tx-customer').value.trim();
    const newNote = document.getElementById('edit-tx-note').value.trim();

    if (newNominal <= 0) {
      showToast('Nominal tidak boleh 0.');
      return;
    }
    if (oldTx.type === 'topup' && newMethod === 'kasbon' && !newCustomer) {
      showToast('Nama pelanggan wajib diisi untuk Kasbon.');
      return;
    }

    // 1. Batalkan efek transaksi lama
    await revertTransactionEffects(oldTx);

    // 2. Terapkan efek transaksi baru
    const targetWallet = await window.arkanDB.getById('wallets', newWalletId);
    const updatedTx = {
      ...oldTx,
      walletId: newWalletId,
      walletName: targetWallet ? targetWallet.shortName : oldTx.walletName,
      nominal: newNominal,
      note: newNote
    };

    if (oldTx.type === 'topup') {
      const totalBill = newNominal + newAdmin;
      updatedTx.adminFee = newAdmin;
      updatedTx.modalDeducted = newNominal;
      updatedTx.totalBill = totalBill;
      updatedTx.netProfit = newAdmin;
      updatedTx.paymentMethod = newMethod;
      updatedTx.customerName = newMethod === 'kasbon' ? newCustomer : '';
      updatedTx.debtId = null;

      if (targetWallet) {
        targetWallet.balance -= newNominal;
        await window.arkanDB.put('wallets', targetWallet);
      }

      if (newMethod === 'tunai') {
        const cashWallet = await window.arkanDB.getById('wallets', 'cash');
        if (cashWallet) {
          cashWallet.balance += totalBill;
          await window.arkanDB.put('wallets', cashWallet);
        }
      } else if (newMethod === 'transfer') {
        const bankWallet = await window.arkanDB.getById('wallets', 'bank');
        if (bankWallet) {
          bankWallet.balance += totalBill;
          await window.arkanDB.put('wallets', bankWallet);
        }
      } else if (newMethod === 'kasbon') {
        const customerKey = newCustomer.toLowerCase();
        const allDebts = await window.arkanDB.getAll('debts');
        let debt = allDebts.find((d) => d.customerKey === customerKey && d.status === 'unpaid');
        const histEntry = {
          id: generateId('dh'),
          type: 'tambah_utang',
          amount: totalBill,
          nominal: newNominal,
          adminFee: newAdmin,
          walletName: updatedTx.walletName,
          note: newNote,
          date: oldTx.createdAt,
          txId: oldTx.id
        };
        if (debt) {
          debt.customerName = newCustomer;
          debt.totalDebt += totalBill;
          debt.remainingAmount += totalBill;
          debt.totalAdmin = (debt.totalAdmin || 0) + newAdmin;
          debt.updatedAt = new Date().toISOString();
          debt.history.push(histEntry);
          await window.arkanDB.put('debts', debt);
          updatedTx.debtId = debt.id;
        } else {
          const newDebtId = generateId('debt');
          await window.arkanDB.put('debts', {
            id: newDebtId,
            customerKey,
            customerName: newCustomer,
            totalDebt: totalBill,
            remainingAmount: totalBill,
            paidAmount: 0,
            totalAdmin: newAdmin,
            status: 'unpaid',
            createdAt: oldTx.createdAt,
            updatedAt: new Date().toISOString(),
            history: [histEntry]
          });
          updatedTx.debtId = newDebtId;
        }
      }
    } else if (oldTx.type === 'expense') {
      if (targetWallet) {
        targetWallet.balance -= newNominal;
        await window.arkanDB.put('wallets', targetWallet);
      }
    } else if (oldTx.type === 'income') {
      if (targetWallet) {
        targetWallet.balance += newNominal;
        await window.arkanDB.put('wallets', targetWallet);
      }
    }

    await window.arkanDB.put('transactions', updatedTx);
    closeModal('modal-edit-tx');
    await refreshAllData();
    showToast('Transaksi berhasil diperbarui!');
  }

  // ==========================================================================
  // 6. HALAMAN KASBON (1 ORANG = 1 UTANG + FITUR BAYAR / CICIL)
  // ==========================================================================

  function renderKasbonPage() {
    const query = (document.getElementById('kasbon-search').value || '').trim().toLowerCase();
    const filter = document.getElementById('kasbon-filter').value;

    const unpaid = state.debts.filter((d) => d.status === 'unpaid' && d.remainingAmount > 0);
    const paid = state.debts.filter((d) => d.status === 'paid' || d.remainingAmount <= 0);

    // Datalist untuk autocomplete nama pelanggan kasbon di form Top Up
    const datalist = document.getElementById('existing-debtors-datalist');
    datalist.innerHTML = unpaid
      .map((d) => `<option value="${escapeHtml(d.customerName)}"></option>`)
      .join('');

    const totalUnpaid = unpaid.reduce((sum, d) => sum + d.remainingAmount, 0);
    document.getElementById('kasbon-header-total').textContent = formatRp(totalUnpaid);
    document.getElementById('unpaid-debts-badge').textContent = formatRp(totalUnpaid);
    document.getElementById('paid-debts-count').textContent = `${paid.length} Lunas`;

    const cardUnpaid = document.getElementById('card-unpaid-debts');
    const cardPaid = document.getElementById('card-paid-debts');
    cardUnpaid.style.display = filter === 'paid' ? 'none' : 'block';
    cardPaid.style.display = filter === 'unpaid' ? 'none' : 'block';

    // Render Piutang Belum Lunas
    const filteredUnpaid = unpaid.filter((d) => d.customerName.toLowerCase().includes(query));
    const unpaidListEl = document.getElementById('unpaid-debts-list');
    if (filteredUnpaid.length === 0) {
      unpaidListEl.innerHTML = '<div class="empty-state">Tidak ada piutang aktif. Arus kas sehat!</div>';
    } else {
      unpaidListEl.innerHTML = filteredUnpaid.map((d) => renderDebtCardHTML(d, false)).join('');
    }

    // Render Riwayat Piutang Lunas
    const filteredPaid = paid.filter((d) => d.customerName.toLowerCase().includes(query));
    const paidListEl = document.getElementById('paid-debts-list');
    if (filteredPaid.length === 0) {
      paidListEl.innerHTML = '<div class="empty-state">Belum ada riwayat piutang lunas.</div>';
    } else {
      paidListEl.innerHTML = filteredPaid.map((d) => renderDebtCardHTML(d, true)).join('');
    }
  }

  function renderDebtCardHTML(debt, isPaidOff) {
    const historyItems = (debt.history || [])
      .slice()
      .reverse()
      .map((h) => {
        const isCicil = h.type === 'cicilan';
        const label = isCicil
          ? `Cicilan (${escapeHtml(h.targetWalletName || 'Tunai')})`
          : `Top Up ${escapeHtml(h.walletName || '')}`;
        const cls = isCicil ? 'text-green fw-bold' : '';
        const prefix = isCicil ? '-' : '+';
        return `
          <div class="debt-hist-item">
            <span>${formatDateTimeShort(h.date)} • ${label}</span>
            <span class="${cls}">${prefix}${formatRp(h.amount)}</span>
          </div>
        `;
      })
      .join('');

    return `
      <div class="debt-card">
        <div class="debt-card-top">
          <div>
            <div class="debt-customer">
              <span>${escapeHtml(debt.customerName)}</span>
              ${isPaidOff ? '<span class="badge-pill badge-lunas">Lunas</span>' : ''}
            </div>
            <div class="debt-sub-meta">
              Total Utang: ${formatRp(debt.totalDebt)} • Terbayar: ${formatRp(debt.paidAmount || 0)}
            </div>
          </div>
          <div class="debt-amount-col">
            <span class="debt-remaining ${isPaidOff ? 'text-green' : ''}">
              ${isPaidOff ? formatRp(debt.totalDebt) : formatRp(debt.remainingAmount)}
            </span>
            <span class="debt-paid-progress">
              ${isPaidOff ? `Dilunasi ${formatDateTimeShort(debt.paidOffAt || debt.updatedAt)}` : 'Sisa belum lunas'}
            </span>
          </div>
        </div>

        ${historyItems ? `<div class="debt-history-list">${historyItems}</div>` : ''}

        <div class="debt-actions-row">
          ${
            !isPaidOff
              ? `<button type="button" class="btn-cicil" data-open-cicil="${debt.id}">
                  💰 Bayar / Cicil
                </button>`
              : `<span class="badge-muted">Selesai &amp; Lunas</span>`
          }
          <button type="button" class="icon-btn-tiny danger" data-delete-debt="${debt.id}" title="Hapus Catatan Kasbon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>
    `;
  }

  function openCicilModal(debtId) {
    const debt = state.debts.find((d) => d.id === debtId);
    if (!debt) return;

    document.getElementById('cicil-debt-id').value = debt.id;
    document.getElementById('cicil-customer-name').textContent = debt.customerName;
    document.getElementById('cicil-remaining-display').textContent = formatRp(debt.remainingAmount);
    document.getElementById('cicil-amount').value = formatThousands(debt.remainingAmount);
    document.getElementById('cicil-note').value = '';

    document.getElementById('btn-cicil-half').onclick = () => {
      const half = Math.ceil(debt.remainingAmount / 2);
      document.getElementById('cicil-amount').value = formatThousands(half);
    };
    document.getElementById('btn-cicil-full').onclick = () => {
      document.getElementById('cicil-amount').value = formatThousands(debt.remainingAmount);
    };

    openModal('modal-cicil');
  }

  async function handleCicilSubmit(e) {
    e.preventDefault();
    const debtId = document.getElementById('cicil-debt-id').value;
    const payAmount = parseRupiahInput(document.getElementById('cicil-amount').value);
    const targetWalletId = document.getElementById('cicil-target-wallet').value;
    const note = document.getElementById('cicil-note').value.trim();

    const debt = await window.arkanDB.getById('debts', debtId);
    if (!debt) return;

    if (payAmount <= 0) {
      showToast('Masukkan nominal pembayaran cicilan.');
      return;
    }
    if (payAmount > debt.remainingAmount) {
      showToast(`Nominal melebihi sisa utang (${formatRp(debt.remainingAmount)}).`);
      return;
    }

    const nowIso = new Date().toISOString();
    const targetWallet = await window.arkanDB.getById('wallets', targetWalletId);
    if (targetWallet) {
      targetWallet.balance += payAmount;
      await window.arkanDB.put('wallets', targetWallet);
    }

    // Kurangi sisa utang pelanggan
    debt.remainingAmount -= payAmount;
    debt.paidAmount = (debt.paidAmount || 0) + payAmount;
    debt.updatedAt = nowIso;

    const histId = generateId('dh');
    debt.history = debt.history || [];
    debt.history.push({
      id: histId,
      type: 'cicilan',
      amount: payAmount,
      targetWalletName: targetWallet ? targetWallet.shortName : 'Tunai Laci',
      note,
      date: nowIso
    });

    if (debt.remainingAmount === 0) {
      debt.status = 'paid';
      debt.paidOffAt = nowIso;
    }

    await window.arkanDB.put('debts', debt);

    // Catat ke riwayat transaksi sebagai pemasukan cicilan
    await window.arkanDB.put('transactions', {
      id: generateId('tx'),
      type: 'installment',
      walletId: targetWalletId,
      walletName: targetWallet ? targetWallet.shortName : 'Tunai Laci',
      nominal: payAmount,
      adminFee: 0,
      totalBill: payAmount,
      netProfit: 0,
      customerName: debt.customerName,
      debtId: debt.id,
      installmentHistId: histId,
      note: note || `Cicilan kasbon ${debt.customerName}`,
      createdAt: nowIso
    });

    closeModal('modal-cicil');
    await refreshAllData();
    showToast(
      debt.remainingAmount === 0
        ? `Kasbon ${debt.customerName} LUNAS!`
        : `Cicilan ${formatRp(payAmount)} tercatat. Sisa: ${formatRp(debt.remainingAmount)}`
    );
  }

  function promptDeleteDebt(debtId) {
    const debt = state.debts.find((d) => d.id === debtId);
    if (!debt) return;
    openConfirmModal(
      `Hapus Catatan Kasbon ${debt.customerName}?`,
      'Data piutang pelanggan ini akan dihapus dari daftar buku kasbon.',
      async () => {
        await window.arkanDB.delete('debts', debtId);
        await refreshAllData();
        showToast('Catatan kasbon dihapus.');
      }
    );
  }

  // ==========================================================================
  // 7. HALAMAN LAPORAN & CATAT PENGELUARAN / PEMASUKAN LAIN
  // ==========================================================================

  function renderReportPage() {
    const period = document.getElementById('report-period-filter').value;
    const filteredTxs = state.transactions.filter((t) => {
      if (period === 'today') return isToday(t.createdAt);
      if (period === 'month') return isThisMonth(t.createdAt);
      return true;
    });

    const topups = filteredTxs.filter((t) => t.type === 'topup');
    const expenses = filteredTxs.filter((t) => t.type === 'expense');

    const totalOmzet = topups.reduce((sum, t) => sum + (t.nominal || 0), 0);

    // Profit Admin (Lunas): hitung dari topup tunai/transfer + topup kasbon yang utangnya sudah lunas
    const paidDebtIds = new Set(
      state.debts.filter((d) => d.status === 'paid' || d.remainingAmount <= 0).map((d) => d.id)
    );
    const realizedProfit = topups.reduce((sum, t) => {
      if (t.paymentMethod !== 'kasbon' || (t.debtId && paidDebtIds.has(t.debtId))) {
        return sum + (t.netProfit || 0);
      }
      return sum;
    }, 0);

    const totalExpense = expenses.reduce((sum, t) => sum + (t.nominal || 0), 0);
    const netProfit = realizedProfit - totalExpense;

    // Total Aset Usaha = Seluruh Saldo Dompet + Laci Tunai + Piutang Aktif
    const totalWalletBalances = state.wallets.reduce((sum, w) => sum + (w.balance || 0), 0);
    const activeReceivables = state.debts
      .filter((d) => d.status === 'unpaid')
      .reduce((sum, d) => sum + d.remainingAmount, 0);
    const totalAssets = totalWalletBalances + activeReceivables;

    document.getElementById('rep-omzet').textContent = formatRp(totalOmzet);
    document.getElementById('rep-profit').textContent = formatRp(realizedProfit);
    document.getElementById('rep-expense').textContent = formatRp(totalExpense);
    document.getElementById('rep-net').textContent = formatRp(netProfit);
    document.getElementById('rep-total-assets').textContent = formatRp(totalAssets);

    // Dropdown Akun Terkait pada Form Catat Arus Kas
    const cfWalletSelect = document.getElementById('cf-wallet');
    const prevSelected = cfWalletSelect.value;
    cfWalletSelect.innerHTML = state.wallets
      .map((w) => `<option value="${w.id}">${escapeHtml(w.name)} (${formatRp(w.balance)})</option>`)
      .join('');
    if (prevSelected && state.wallets.some((w) => w.id === prevSelected)) {
      cfWalletSelect.value = prevSelected;
    } else {
      cfWalletSelect.value = 'cash';
    }

    // Daftar Semua Transaksi
    document.getElementById('all-tx-count').textContent = `${filteredTxs.length} transaksi`;
    const allListEl = document.getElementById('all-transactions-list');
    if (filteredTxs.length === 0) {
      allListEl.innerHTML = '<div class="empty-state">Tidak ada transaksi pada periode ini.</div>';
    } else {
      allListEl.innerHTML = filteredTxs.map((t) => renderTransactionItemHTML(t)).join('');
    }
  }

  async function handleCashflowSubmit(e) {
    e.preventDefault();
    const cfType = document.getElementById('cf-type').value; // 'expense' | 'income'
    const walletId = document.getElementById('cf-wallet').value;
    const nominal = parseRupiahInput(document.getElementById('cf-nominal').value);
    const note = document.getElementById('cf-note').value.trim();

    if (nominal <= 0) {
      showToast('Masukkan nominal catatan kas.');
      return;
    }
    if (!note) {
      showToast('Keterangan wajib diisi.');
      return;
    }

    const wallet = await window.arkanDB.getById('wallets', walletId);
    if (!wallet) return;

    if (cfType === 'expense') {
      wallet.balance -= nominal;
    } else {
      wallet.balance += nominal;
    }
    await window.arkanDB.put('wallets', wallet);

    await window.arkanDB.put('transactions', {
      id: generateId('tx'),
      type: cfType,
      walletId: wallet.id,
      walletName: wallet.shortName,
      nominal,
      adminFee: 0,
      totalBill: nominal,
      netProfit: 0,
      note,
      createdAt: new Date().toISOString()
    });

    document.getElementById('cf-nominal').value = '';
    document.getElementById('cf-note').value = '';
    await refreshAllData();
    showToast(cfType === 'expense' ? 'Pengeluaran berhasil dicatat.' : 'Pemasukan kas berhasil dicatat.');
  }

  // ==========================================================================
  // 8. HALAMAN DATA (KELOLA DOMPET, EDIT/HAPUS DOMPET, BACKUP JSON/CSV)
  // ==========================================================================

  function renderDataPage() {
    const listEl = document.getElementById('manage-wallets-list');
    listEl.innerHTML = state.wallets
      .map(
        (w) => `
        <div class="manage-wallet-row">
          <div>
            <strong>${escapeHtml(w.name)}</strong>
            <div class="tx-meta">${formatRp(w.balance)}</div>
          </div>
          <div class="tx-actions">
            <button type="button" class="icon-btn-tiny" data-edit-wallet="${w.id}" title="Edit Dompet">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            ${
              !w.isPrimary && !w.isCash
                ? `<button type="button" class="icon-btn-tiny danger" data-delete-wallet="${w.id}" title="Hapus Dompet">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                  </button>`
                : ''
            }
          </div>
        </div>
      `
      )
      .join('');
  }

  async function handleAddWalletSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('new-wallet-name').value.trim();
    const balance = parseRupiahInput(document.getElementById('new-wallet-balance').value);
    if (!name) return;

    const newWallet = {
      id: generateId('wallet'),
      name,
      shortName: name,
      balance,
      isPrimary: false,
      isCash: false,
      order: state.wallets.length + 1
    };
    await window.arkanDB.put('wallets', newWallet);
    document.getElementById('new-wallet-name').value = '';
    document.getElementById('new-wallet-balance').value = '0';
    await refreshAllData();
    showToast(`Dompet "${name}" ditambahkan!`);
  }

  function openEditWalletModal(walletId, mode = 'edit') {
    const wallet = state.wallets.find((w) => w.id === walletId) || state.wallets[0];
    document.getElementById('edit-wallet-mode').value = mode;
    document.getElementById('edit-wallet-id').value = wallet.id;

    const selectWrap = document.getElementById('edit-wallet-select-wrap');
    const nameWrap = document.getElementById('edit-wallet-name-wrap');
    const amountLabel = document.getElementById('edit-wallet-amount-label');
    const titleEl = document.getElementById('modal-wallet-title');

    if (mode === 'deposit') {
      titleEl.textContent = 'Tambah Saldo / Deposit';
      selectWrap.style.display = 'block';
      nameWrap.style.display = 'none';
      amountLabel.textContent = 'Nominal Deposit Masuk (Rp)';
      const sel = document.getElementById('deposit-wallet-select');
      sel.innerHTML = state.wallets
        .map((w) => `<option value="${w.id}">${escapeHtml(w.name)} (${formatRp(w.balance)})</option>`)
        .join('');
      sel.value = wallet.id;
      document.getElementById('edit-wallet-amount').value = '';
    } else {
      titleEl.textContent = 'Edit Saldo Dompet';
      selectWrap.style.display = 'none';
      nameWrap.style.display = 'block';
      amountLabel.textContent = 'Saldo Saat Ini (Rp)';
      document.getElementById('edit-wallet-name').value = wallet.name;
      document.getElementById('edit-wallet-amount').value = formatThousands(wallet.balance);
    }

    openModal('modal-wallet');
  }

  async function handleEditWalletSubmit(e) {
    e.preventDefault();
    const mode = document.getElementById('edit-wallet-mode').value;

    if (mode === 'deposit') {
      const targetId = document.getElementById('deposit-wallet-select').value;
      const addAmount = parseRupiahInput(document.getElementById('edit-wallet-amount').value);
      if (addAmount <= 0) {
        showToast('Masukkan nominal deposit.');
        return;
      }
      const wallet = await window.arkanDB.getById('wallets', targetId);
      if (wallet) {
        wallet.balance += addAmount;
        await window.arkanDB.put('wallets', wallet);
        await window.arkanDB.put('transactions', {
          id: generateId('tx'),
          type: 'income',
          walletId: wallet.id,
          walletName: wallet.shortName,
          nominal: addAmount,
          adminFee: 0,
          totalBill: addAmount,
          netProfit: 0,
          note: `Deposit saldo ${wallet.shortName}`,
          createdAt: new Date().toISOString()
        });
      }
      closeModal('modal-wallet');
      await refreshAllData();
      showToast(`Deposit ${formatRp(addAmount)} berhasil ditambahkan!`);
      return;
    }

    const walletId = document.getElementById('edit-wallet-id').value;
    const newName = document.getElementById('edit-wallet-name').value.trim();
    const newBalance = parseRupiahInput(document.getElementById('edit-wallet-amount').value);

    const wallet = await window.arkanDB.getById('wallets', walletId);
    if (wallet && newName) {
      wallet.name = newName;
      if (!wallet.isPrimary && !wallet.isCash) {
        wallet.shortName = newName;
      }
      wallet.balance = newBalance;
      await window.arkanDB.put('wallets', wallet);
    }

    closeModal('modal-wallet');
    await refreshAllData();
    showToast('Saldo dompet diperbarui.');
  }

  function promptDeleteWallet(walletId) {
    const wallet = state.wallets.find((w) => w.id === walletId);
    if (!wallet) return;
    openConfirmModal(
      `Hapus Dompet ${wallet.name}?`,
      'Akun dompet ini akan dihapus dari daftar saldo.',
      async () => {
        await window.arkanDB.delete('wallets', walletId);
        await refreshAllData();
        showToast('Dompet dihapus.');
      }
    );
  }

  // Backup JSON, Export CSV, Restore JSON, & Browser Notification
  async function exportJSONBackup() {
    const data = await window.arkanDB.exportBackupData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `arkan-konter-backup-${dateStamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('File backup .JSON berhasil diunduh.');
  }

  async function exportCSVReport() {
    const headers = ['Waktu', 'Jenis', 'Akun', 'Nominal', 'Biaya Admin', 'Total Tagihan', 'Metode', 'Pelanggan', 'Catatan'];
    const rows = state.transactions.map((t) => [
      new Date(t.createdAt).toLocaleString('id-ID'),
      t.type,
      t.walletName || '',
      t.nominal || 0,
      t.adminFee || 0,
      t.totalBill || t.nominal || 0,
      t.paymentMethod || '-',
      t.customerName || '-',
      (t.note || '').replace(/,/g, ' ')
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `laporan-arkan-konter-${dateStamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Laporan transaksi .CSV berhasil diunduh.');
  }

  async function handleRestoreJSON(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      await window.arkanDB.importBackupData(parsed);
      await refreshAllData();
      showToast('Data berhasil di-restore dari file backup!');
    } catch (err) {
      showToast('Gagal membaca file backup JSON.');
    } finally {
      e.target.value = '';
    }
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) {
      showToast('Browser tidak mendukung notifikasi.');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      new Notification('Arkan Konter', {
        body: 'Pengingat jadwal isi ulang Selasa & Jumat serta tagihan kasbon aktif!',
        icon: 'icon-192.png'
      });
      showToast('Notifikasi pengingat diaktifkan.');
    } else {
      showToast('Izin notifikasi ditolak browser.');
    }
  }

  // ==========================================================================
  // 9. NAVIGASI, MODAL HELPERS & EVENT LISTENERS
  // ==========================================================================

  function switchView(viewName) {
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) targetView.classList.add('active');

    document.querySelectorAll('.bottom-nav .nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.nav === viewName);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
  }

  function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  }

  function openConfirmModal(title, message, onConfirm) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    state.confirmCallback = onConfirm;
    openModal('modal-confirm');
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function bindEvents() {
    // Navigasi antar halaman
    document.addEventListener('click', (e) => {
      const navBtn = e.target.closest('[data-nav]');
      if (navBtn) {
        switchView(navBtn.dataset.nav);
        return;
      }

      const closeBtn = e.target.closest('[data-close-modal]');
      if (closeBtn) {
        closeModal(closeBtn.dataset.closeModal);
        return;
      }

      const selectWalletBtn = e.target.closest('[data-select-wallet]');
      if (selectWalletBtn) {
        state.selectedWalletId = selectWalletBtn.dataset.selectWallet;
        renderTopUpFormWallets();
        return;
      }

      const presetBtn = e.target.closest('[data-nominal]');
      if (presetBtn) {
        const val = parseInt(presetBtn.dataset.nominal, 10);
        document.getElementById('topup-nominal').value = formatThousands(val);
        state.adminManuallyEdited = false;
        updateTopUpCalculation(true);
        return;
      }

      const editWalletBtn = e.target.closest('[data-edit-wallet]');
      if (editWalletBtn) {
        openEditWalletModal(editWalletBtn.dataset.editWallet, 'edit');
        return;
      }

      const deleteWalletBtn = e.target.closest('[data-delete-wallet]');
      if (deleteWalletBtn) {
        promptDeleteWallet(deleteWalletBtn.dataset.deleteWallet);
        return;
      }

      const editTxBtn = e.target.closest('[data-edit-tx]');
      if (editTxBtn) {
        openEditTransactionModal(editTxBtn.dataset.editTx);
        return;
      }

      const deleteTxBtn = e.target.closest('[data-delete-tx]');
      if (deleteTxBtn) {
        promptDeleteTransaction(deleteTxBtn.dataset.deleteTx);
        return;
      }

      const cicilBtn = e.target.closest('[data-open-cicil]');
      if (cicilBtn) {
        openCicilModal(cicilBtn.dataset.openCicil);
        return;
      }

      const delDebtBtn = e.target.closest('[data-delete-debt]');
      if (delDebtBtn) {
        promptDeleteDebt(delDebtBtn.dataset.deleteDebt);
        return;
      }
    });

    // Tombol cepat di Beranda
    document.getElementById('btn-open-deposit').addEventListener('click', () => {
      openEditWalletModal('dana', 'deposit');
    });
    document.getElementById('btn-edit-primary-wallet').addEventListener('click', () => {
      openEditWalletModal('dana', 'edit');
    });
    document.getElementById('btn-edit-cash-wallet').addEventListener('click', () => {
      openEditWalletModal('cash', 'edit');
    });
    document.getElementById('btn-quick-expense').addEventListener('click', () => {
      switchView('laporan');
      setTimeout(() => {
        document.getElementById('cf-type').value = 'expense';
        document.getElementById('cf-nominal').focus();
      }, 150);
    });
    document.getElementById('btn-floating-badge').addEventListener('click', () => {
      switchView('data');
    });

    // Tombol Pintas "000" pada seluruh form nominal
    bindNominalInputWithTripleZero(
      document.getElementById('topup-nominal'),
      document.getElementById('btn-topup-000'),
      () => {
        state.adminManuallyEdited = false;
        updateTopUpCalculation(true);
      }
    );
    bindNominalInputWithTripleZero(
      document.getElementById('cf-nominal'),
      document.getElementById('btn-cf-000')
    );
    bindNominalInputWithTripleZero(
      document.getElementById('new-wallet-balance'),
      document.getElementById('btn-newwallet-000')
    );
    bindNominalInputWithTripleZero(
      document.getElementById('edit-wallet-amount'),
      document.getElementById('btn-modalwallet-000')
    );
    bindNominalInputWithTripleZero(
      document.getElementById('cicil-amount'),
      document.getElementById('btn-cicil-000')
    );

    // Clear nominal top up
    document.getElementById('btn-topup-clear').addEventListener('click', () => {
      document.getElementById('topup-nominal').value = '';
      state.adminManuallyEdited = false;
      updateTopUpCalculation(true);
      document.getElementById('topup-nominal').focus();
    });

    // Edit manual biaya admin & potongan modal
    document.getElementById('topup-admin').addEventListener('input', (e) => {
      state.adminManuallyEdited = true;
      const v = parseRupiahInput(e.target.value);
      e.target.value = v > 0 ? formatThousands(v) : '0';
      updateTopUpCalculation(false);
    });

    document.getElementById('topup-modal').addEventListener('input', (e) => {
      const v = parseRupiahInput(e.target.value);
      e.target.value = v > 0 ? formatThousands(v) : '0';
      const nominal = parseRupiahInput(document.getElementById('topup-nominal').value);
      const admin = parseRupiahInput(document.getElementById('topup-admin').value);
      const totalBill = nominal + admin;
      document.getElementById('summary-total-bill').textContent = formatRp(totalBill);
      document.getElementById('summary-net-profit').textContent = formatRp(totalBill - v);
    });

    // Segmented Control Metode Pembayaran (Tunai / Transfer / Kasbon)
    document.querySelectorAll('#payment-method-control .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#payment-method-control .seg-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedPaymentMethod = btn.dataset.method;

        const kasbonGroup = document.getElementById('kasbon-customer-group');
        if (state.selectedPaymentMethod === 'kasbon') {
          kasbonGroup.classList.remove('hidden');
          document.getElementById('topup-customer-name').focus();
        } else {
          kasbonGroup.classList.add('hidden');
        }
      });
    });

    // Submit Forms
    document.getElementById('form-topup').addEventListener('submit', handleTopUpSubmit);
    document.getElementById('form-cashflow').addEventListener('submit', handleCashflowSubmit);
    document.getElementById('form-add-wallet').addEventListener('submit', handleAddWalletSubmit);
    document.getElementById('form-edit-wallet').addEventListener('submit', handleEditWalletSubmit);
    document.getElementById('form-edit-tx').addEventListener('submit', handleEditTransactionSubmit);
    document.getElementById('form-cicil').addEventListener('submit', handleCicilSubmit);

    // Confirm Hapus
    document.getElementById('btn-confirm-yes').addEventListener('click', async () => {
      closeModal('modal-confirm');
      if (typeof state.confirmCallback === 'function') {
        await state.confirmCallback();
        state.confirmCallback = null;
      }
    });

    // Filter Kasbon & Laporan
    document.getElementById('kasbon-search').addEventListener('input', renderKasbonPage);
    document.getElementById('kasbon-filter').addEventListener('change', renderKasbonPage);
    document.getElementById('report-period-filter').addEventListener('change', renderReportPage);

    // Backup & Restore
    document.getElementById('btn-export-json').addEventListener('click', exportJSONBackup);
    document.getElementById('btn-export-csv').addEventListener('click', exportCSVReport);
    document.getElementById('input-restore-json').addEventListener('change', handleRestoreJSON);
    document.getElementById('btn-enable-notif').addEventListener('click', requestNotificationPermission);

    // Status Online / Offline
    window.addEventListener('online', renderHeaderAndSchedule);
    window.addEventListener('offline', renderHeaderAndSchedule);
  }

  // Registrasi Service Worker untuk 100% Offline PWA
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {
        // Abaikan jika dibuka langsung lewat file://
      });
    }
  }

  // Bootstrap Aplikasi
  document.addEventListener('DOMContentLoaded', async () => {
    registerServiceWorker();
    bindEvents();
    await window.arkanDB.init();
    await refreshAllData();
  });
})();
