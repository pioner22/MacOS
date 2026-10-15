package MacDiag::Runner;
use strict;
use warnings;
use POSIX qw(setsid _exit);
use IO::Select;
use Time::HiRes qw(clock_gettime CLOCK_MONOTONIC sleep);
use Encode qw(decode FB_DEFAULT);

# Only fixed adapters call this runner. Registry/snapshot text is NEVER a command.
# A session leader stays alive until group cleanup, preventing PGID reuse after
# the actual command exits. Children escaping the session are outside this contract.
sub new { bless {}, shift }
sub run {
    my ($self, $argv, %opt) = @_;
    die "RUNNER_INVALID_ARGUMENT\n" unless ref($argv) eq 'ARRAY' && @$argv &&
        $argv->[0] =~ m{\A/} && !grep { !defined($_) || ref($_) || /\0/ } @$argv;
    my $limit = $opt{max_bytes} || 131072;
    my $timeout = $opt{timeout} || 5;
    die "RUNNER_LIMIT\n" unless $timeout > 0 && $timeout <= 120 && $limit > 0 && $limit <= 1048576;
    my $start = clock_gettime(CLOCK_MONOTONIC);
    pipe(my $out_r, my $out_w) or die "PIPE\n";
    pipe(my $err_r, my $err_w) or die "PIPE\n";
    pipe(my $state_r, my $state_w) or die "PIPE\n";
    pipe(my $hold_r, my $hold_w) or die "PIPE\n";
    my $leader = fork();
    die "FORK\n" unless defined $leader;
    if (!$leader) {
        close $out_r; close $err_r; close $state_r; close $hold_w;
        my $sid = setsid();
        _exit(125) if !defined($sid) || $sid < 0;
        $SIG{TERM} = 'IGNORE'; $SIG{INT} = 'IGNORE'; $SIG{HUP} = 'IGNORE';
        syswrite($state_w, "GROUP\n");
        # Do not spawn the command until the parent knows this group exists.
        my $go;
        _exit(125) unless sysread($hold_r, $go, 1) && $go eq "G";
        my $worker = fork();
        _exit(125) unless defined $worker;
        if (!$worker) {
            close $state_w; close $hold_r;
            $SIG{TERM} = 'DEFAULT'; $SIG{INT} = 'DEFAULT'; $SIG{HUP} = 'DEFAULT';
            $SIG{PIPE} = 'DEFAULT'; $SIG{ALRM} = 'DEFAULT';
            open(STDIN, '<', '/dev/null') or _exit(125);
            open(STDOUT, '>&', $out_w) or _exit(125);
            open(STDERR, '>&', $err_w) or _exit(125);
            close $out_w; close $err_w;
            %ENV = (PATH => '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL => 'C', LANG => 'C');
            chdir('/') or _exit(125);
            { no warnings 'exec'; exec { $argv->[0] } @$argv; }
            print STDERR "EXEC_FAILED\n";
            _exit(127);
        }
        close $out_w; close $err_w;
        waitpid($worker, 0);
        syswrite($state_w, 'EXIT ' . $? . "\n");
        close $state_w;
        # Keep this PID allocated even when the actual command has exited.
        my $token;
        sysread($hold_r, $token, 1);
        _exit(0);
    }
    close $out_w; close $err_w; close $state_w; close $hold_r;
    my $sel = IO::Select->new($out_r, $err_r, $state_r);
    my %which = (fileno($out_r) => 'stdout', fileno($err_r) => 'stderr', fileno($state_r) => 'control');
    my %buf = (stdout => '', stderr => '', control => '');
    my ($group, $raw, $reason) = (0, undef, 'EXECUTED');
    my $released = 0;
    my $cancelled = 0;
    local $SIG{INT} = sub { $cancelled = 1 };
    local $SIG{TERM} = sub { $cancelled = 1 };
    local $SIG{HUP} = sub { $cancelled = 1 };
    while (1) {
        if ($cancelled) { $reason = 'CANCELLED'; last }
        if (clock_gettime(CLOCK_MONOTONIC) - $start > $timeout) { $reason = 'TIMEOUT'; last }
        for my $fh ($sel->can_read(0.02)) {
            my $n = sysread($fh, my $piece, 8192);
            next if !defined($n) && $!{EINTR};
            if (!defined($n)) { $reason = 'IO_ERROR'; last }
            if (!$n) { $sel->remove($fh); close $fh; next }
            my $name = $which{fileno($fh)};
            $buf{$name} .= $piece;
            if (length($buf{stdout}) + length($buf{stderr}) > $limit || length($buf{control}) > 128) {
                $reason = 'OUTPUT_LIMIT'; last;
            }
        }
        $group = 1 if $buf{control} =~ /\AGROUP\n/;
        if ($group && !$released) { syswrite($hold_w, 'G'); $released = 1 }
        $raw = 0 + $1 if $buf{control} =~ /\nEXIT (\d+)\n/;
        last if $reason ne 'EXECUTED';
        last if defined($raw) && !$sel->count;
        if (!$sel->count && !defined($raw)) { $reason = 'SUPERVISOR_ERROR'; last }
    }
    # Never reap the leader before terminating its group. The leader ignores TERM.
    if ($group) { kill 'TERM', -$leader; sleep(0.03); kill 'KILL', -$leader }
    else { kill 'KILL', $leader }
    waitpid($leader, 0);
    close $hold_w;
    for my $fh ($sel->handles) { close $fh }
    my $status = defined($raw) ? $raw : 0;
    return {
        state => $reason,
        exit_code => defined($raw) ? ($status >> 8) : undef,
        signal => defined($raw) ? ($status & 127) : undef,
        stdout => decode('UTF-8', substr($buf{stdout}, 0, $limit), FB_DEFAULT),
        stderr => decode('UTF-8', substr($buf{stderr}, 0, $limit), FB_DEFAULT),
        duration_ms => int((clock_gettime(CLOCK_MONOTONIC) - $start) * 1000),
    };
}
sub ok {
    my ($r) = @_;
    return $r->{state} eq 'EXECUTED' && defined($r->{exit_code}) && $r->{exit_code} == 0 && !$r->{signal};
}
1;
