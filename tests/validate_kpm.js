#!/usr/bin/env node
/**
 * KPM Static Validation Test
 *
 * Validates ELF structure of .kpm and .ko files without requiring ARM64 execution.
 * Tests: format detection, section requirements, metadata extraction, symbol analysis.
 */

const fs = require('fs');
const path = require('path');

const KPM_DIR = path.join(__dirname, 'kpm');

// Known KP symbols that the loader/exporter provides (subset for validation)
const KNOWN_KP_SYMBOLS = new Set([
    'kallsyms_lookup_name', 'symbol_lookup_name', 'compact_find_symbol',
    'current_uid', 'is_su_allow_uid', 'commit_su', 'commit_common_su',
    'set_all_allow_sctx', 'app_profile_set', 'app_profile_get',
    'check_umount_modules', 'kp_safe_mode', 'umount_add_path',
    'umount_remove_path', 'security_secctx_to_secid',
    'set_security_override_from_ctx', 'hook', 'hook_syscalln',
    'unhook_syscalln', 'hook_install', 'hook_uninstall', 'hook_wrap',
    'hotpatch_nosync', 'unhook', 'printk', 'kver', 'kpver',
    'compat_copy_to_user', 'compat_strncpy_from_user',
    'kf_snprintf', 'kf_strlen', 'kf_strncpy', 'kf_strcmp', 'kf_strncmp',
    'kf_strchr', 'kf_memcmp', 'kf_strstr', 'kf_strcpy', 'kf_strcat',
    'kf_strncat', 'kf_sprintf',
    'sp_el0_is_current', 'thread_info_in_task', 'sp_el0_is_thread_info',
    'thread_size', 'task_in_thread_info_offset', 'task_struct_offset',
    'mm_struct_offset', 'sys_call_table', 'compat_sys_call_table',
    'has_config_compat', 'get_ap_mod_exclude', 'branch_absolute',
    'kallsyms_on_each_symbol', 'syscalln_name_addr', 'syscalln_addr',
    'hook_compat_syscalln', 'unhook_compat_syscalln',
    'selinux_hide_is_active', 'selinux_hide_init',
]);

// Symbols available via kallsyms_lookup_name (kernel symbols)
const COMMON_KERNEL_SYMBOLS = new Set([
    'memcpy', 'memset', 'strlen', 'strnlen', 'register_kprobe', 'unregister_kprobe',
    'proc_create', 'remove_proc_entry', 'mutex_lock', 'mutex_unlock',
    'crypto_alloc_shash', 'crypto_shash_update', 'crypto_shash_final',
    'crypto_destroy_tfm', 'kfree_sensitive', '__kmalloc', 'kfree',
    'kmalloc_caches', 'single_open', 'single_release', 'seq_read',
    'seq_lseek', 'seq_printf', 'seq_puts', 'seq_putc',
    'queue_delayed_work_on', 'cancel_delayed_work_sync',
    'init_timer_key', 'delayed_work_timer_fn', 'system_wq',
    'param_ops_charp', '__stack_chk_fail', 'fortify_panic',
    '__list_del_entry_valid_or_report', '__check_object_size',
    'alt_cb_patch_nops', '__arch_copy_from_user', 'system_cpucaps',
]);

let passed = 0;
let failed = 0;
let warnings = 0;

function ok(msg) { passed++; console.log(`  ✓ ${msg}`); }
function fail(msg) { failed++; console.error(`  ✗ ${msg}`); }
function warn(msg) { warnings++; console.log(`  ⚠ ${msg}`); }

function readElf64(filepath) {
    const data = fs.readFileSync(filepath);
    if (data.length < 64) return null;
    if (data[0] !== 0x7f || data[1] !== 0x45 || data[2] !== 0x4c || data[3] !== 0x46) return null;
    if (data[4] !== 2) return null; // ELF64
    if (data[5] !== 1) return null; // little-endian
    if (data[18] !== 0xB7 || data[19] !== 0x00) return null; // EM_AARCH64

    const e_shoff = Number(data.readBigUInt64LE(0x28));
    const e_shentsize = data.readUInt16LE(0x3A);
    const e_shnum = data.readUInt16LE(0x3C);
    const e_shstrndx = data.readUInt16LE(0x3E);

    // Read section header string table
    const shstrOff = Number(data.readBigUInt64LE(e_shoff + e_shstrndx * e_shentsize + 0x18));
    const shstrSize = Number(data.readBigUInt64LE(e_shoff + e_shstrndx * e_shentsize + 0x20));
    // Bounds-check section header string table
    if (shstrOff >= data.length || shstrOff + shstrSize > data.length) {
        console.error('  Section header string table extends beyond file');
        return null;
    }
    const shstr = data.slice(shstrOff, shstrOff + shstrSize);

    const sections = [];
    for (let i = 0; i < e_shnum; i++) {
        const off = e_shoff + i * e_shentsize;
        const sh_name = data.readUInt32LE(off);
        const sh_type = data.readUInt32LE(off + 4);
        const sh_flags = Number(data.readBigUInt64LE(off + 8));
        const sh_addr = Number(data.readBigUInt64LE(off + 0x10));
        const sh_offset = Number(data.readBigUInt64LE(off + 0x18));
        const sh_size = Number(data.readBigUInt64LE(off + 0x20));
        const sh_link = data.readUInt32LE(off + 0x28);
        const sh_info = data.readUInt32LE(off + 0x2C);
        const sh_entsize = Number(data.readBigUInt64LE(off + 0x38));

        const nullIdx = shstr.indexOf(0, sh_name);
        const name = shstr.slice(sh_name, nullIdx > 0 ? nullIdx : sh_name + 30).toString('ascii');

        sections.push({ idx: i, name, type: sh_type, sh_type, sh_flags, sh_addr, sh_offset, sh_size, sh_link, sh_info, sh_entsize });
    }

    // Find symtab and strtab
    let symtab = null, strtab = null;
    for (const sec of sections) {
        if (sec.sh_type === 2) { // SHT_SYMTAB
            symtab = sec;
            strtab = sections[sec.sh_link];
        }
    }

    // Read symbol names
    const symbols = [];
    if (symtab && strtab) {
        const strData = data.slice(strtab.sh_offset, strtab.sh_offset + strtab.sh_size);
        const numEntries = Math.floor(symtab.sh_size / symtab.sh_entsize);
        for (let i = 0; i < numEntries; i++) {
            const symOff = symtab.sh_offset + i * symtab.sh_entsize;
            const st_name = data.readUInt32LE(symOff);
            const st_info = data.readUInt8(symOff + 4);
            const st_shndx = data.readUInt16LE(symOff + 6);
            const st_type = st_info & 0xf;
            const nullIdx = strData.indexOf(0, st_name);
            const nameEnd = (nullIdx !== -1 && nullIdx > st_name) ? nullIdx : Math.min(st_name + 60, strData.length);
            const name = st_name > 0 ? strData.slice(st_name, nameEnd).toString('ascii') : '';
            symbols.push({ name, type: st_type, shndx: st_shndx });
        }
    }

    return { data, sections, symbols, symtab, strtab };
}

function getModinfo(sections, data, tagName) {
    for (const sec of sections) {
        if (sec.name === '.kpm.info' || sec.name === '.modinfo') {
            const buf = data.slice(sec.sh_offset, sec.sh_offset + sec.sh_size);
            const str = buf.toString('ascii');
            const entries = str.split('\0').filter(s => s.includes('='));
            for (const entry of entries) {
                const eqIdx = entry.indexOf('=');
                const key = entry.slice(0, eqIdx);
                const val = entry.slice(eqIdx + 1);
                if (key === tagName) return val;
            }
        }
    }
    return null;
}

function testKpmFile(filepath) {
    const basename = path.basename(filepath);
    console.log(`\n═══ ${basename} ═══`);

    // 1. ELF validation
    const elf = readElf64(filepath);
    if (!elf) { fail('Not a valid aarch64 ELF relocatable'); return; }
    ok('Valid ELF64 aarch64 relocatable');

    // 2. Format detection
    const sectionNames = new Set(elf.sections.map(s => s.name));
    const hasKpmInit = sectionNames.has('.kpm.init') || sectionNames.has('.kpm.exit');
    const hasKoInit = sectionNames.has('.init.text') || sectionNames.has('.exit.text');
    const hasKpmInfo = sectionNames.has('.kpm.info');
    const hasModinfo = sectionNames.has('.modinfo');

    let format;
    if (hasKpmInit) {
        format = 'kpm';
        ok('Format: KPM (has .kpm.init/.kpm.exit)');
    } else if (hasKoInit) {
        format = 'ko';
        ok('Format: KO (has .init.text/.exit.text)');
    } else {
        fail('Unknown format: no .kpm.init/.kpm.exit or .init.text/.exit.text');
        return;
    }

    // 3. Required sections check
    if (format === 'kpm') {
        if (sectionNames.has('.kpm.init')) ok('Has .kpm.init');
        else fail('Missing .kpm.init');
        if (sectionNames.has('.kpm.exit')) ok('Has .kpm.exit');
        else fail('Missing .kpm.exit');
        if (sectionNames.has('.kpm.info')) ok('Has .kpm.info');
        else warn('Missing .kpm.info (metadata will be auto-generated)');
        if (sectionNames.has('.kpm.ctl0')) ok('Has .kpm.ctl0 (control callback)');
        if (sectionNames.has('.kpm.event')) ok('Has .kpm.event (event callback)');
    } else {
        if (sectionNames.has('.init.text')) ok('Has .init.text');
        else fail('Missing .init.text');
        if (sectionNames.has('.exit.text')) ok('Has .exit.text');
        else warn('Missing .exit.text (no cleanup)');
        if (hasModinfo) ok('Has .modinfo (metadata)');
        else warn('Missing .modinfo (metadata will be defaults)');
    }

    // 4. Metadata extraction
    if (hasKpmInfo || hasModinfo) {
        const name = getModinfo(elf.sections, elf.data, 'name');
        const version = getModinfo(elf.sections, elf.data, 'version');
        const license = getModinfo(elf.sections, elf.data, 'license');
        if (name) ok(`Metadata name: "${name}"`);
        else warn('No name in metadata');
        if (version) ok(`Metadata version: "${version}"`);
        if (license) ok(`Metadata license: "${license}"`);
    }

    // 5. Symbol analysis
    const undefinedSymbols = elf.symbols.filter(s => s.shndx === 0 && s.type === 0 && s.name);
    const resolved = [];
    const unresolved = [];

    for (const sym of undefinedSymbols) {
        if (KNOWN_KP_SYMBOLS.has(sym.name)) {
            resolved.push(sym.name);
        } else if (COMMON_KERNEL_SYMBOLS.has(sym.name)) {
            resolved.push(sym.name + ' (kernel)');
        } else {
            unresolved.push(sym.name);
        }
    }

    ok(`Undefined symbols: ${undefinedSymbols.length} total, ${resolved.length} resolvable, ${unresolved.length} unknown`);

    if (unresolved.length > 0) {
        for (const sym of unresolved.slice(0, 10)) {
            warn(`Unknown symbol: ${sym} (may resolve via kallsyms_lookup_name at runtime)`);
        }
        if (unresolved.length > 10) {
            warn(`... and ${unresolved.length - 10} more`);
        }
    }

    // 6. Section size sanity
    let totalSize = 0;
    for (const sec of elf.sections) {
        if (sec.sh_flags & 0x2) totalSize += sec.sh_size; // SHF_ALLOC
    }
    ok(`Total alloc size: ${(totalSize / 1024).toFixed(1)} KB`);

    return { format, unresolved: unresolved.length, name: getModinfo(elf.sections, elf.data, 'name') };
}

// Main
console.log('KPM Static Validation Test');
console.log('==========================');

const files = fs.readdirSync(KPM_DIR)
    .filter(f => f.endsWith('.kpm') || f.endsWith('.ko'))
    .map(f => path.join(KPM_DIR, f));

if (files.length === 0) {
    console.log('No test files found in tests/kpm/');
    process.exit(1);
}

const results = [];
for (const f of files) {
    results.push(testKpmFile(f));
}

// Summary
console.log('\n═══ Summary ═══');
console.log(`Passed: ${passed}, Failed: ${failed}, Warnings: ${warnings}`);
console.log(`Files tested: ${files.length}`);

for (const r of results) {
    if (r) {
        console.log(`  ${r.name || 'unknown'}: ${r.format} format, ${r.unresolved} unresolved symbols`);
    }
}

process.exit(failed > 0 ? 1 : 0);
