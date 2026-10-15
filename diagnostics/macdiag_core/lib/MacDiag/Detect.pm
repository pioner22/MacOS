package MacDiag::Detect;
use strict;
use warnings;
use Digest::SHA qw(sha256_hex);
use JSON::PP;
use POSIX qw(strftime);
use MacDiag::Runner;
use MacDiag::Adapters;

sub new { my ($class,%opt)=@_; bless \%opt,$class }
sub probe { my ($self,$argv)=@_; $self->{runner}->run($argv,timeout=>5,max_bytes=>131072) }
sub clean {
    my ($s)=@_; $s='' unless defined $s;
    $s =~ s/[\x00-\x1f\x7f-\x9f]//g;
    $s =~ s/\A\s+|\s+\z//g; return substr($s,0,256);
}
sub value {
    my ($self,$argv)=@_; my $r=$self->probe($argv);
    return undef unless MacDiag::Runner::ok($r);
    return clean($r->{stdout});
}
sub exists { my ($self,$path)=@_; return $self->{path_exists} ? $self->{path_exists}->($path) : -e $path }
sub executable { my ($self,$path)=@_; return $self->{path_exec} ? $self->{path_exec}->($path) : (-f $path && -x $path) }
sub family {
    my ($v)=@_;
    return 'unknown' unless defined($v) && $v =~ /\A[0-9]+(?:\.[0-9]+){1,2}\z/;
    my %names=('10.13'=>'high_sierra','10.14'=>'mojave','10.15'=>'catalina',11=>'big_sur',12=>'monterey',13=>'ventura',14=>'sonoma',15=>'sequoia',26=>'tahoe');
    my @parts=split /\./,$v;
    return $names{$parts[0] eq '10'?join('.',@parts[0,1]):$parts[0]} || 'unknown';
}
sub derive {
    my ($raw)=@_;
    my %f=(kernel=>$raw->{kernel}||'unknown', process_arch=>$raw->{process_arch}||'unknown',
        model_identifier=>$raw->{model_identifier}||'unknown',os_version=>$raw->{os_version}||'unknown',
        os_build=>$raw->{os_build}||'unknown',os_family=>family($raw->{os_version}),hardware_family=>'unknown',
        environment=>'unknown',environment_confidence=>'UNKNOWN',recovery_origin=>'unknown',
        ram_bytes=>$raw->{ram_bytes},cpu_brand=>$raw->{cpu_brand},translated=>$raw->{translated},
        bash_family=>'unknown');
    if (($raw->{system_bash}||'') =~ /\A3\.2(?:\.|\z)/) {$f{bash_family}='bash32'}
    elsif (($raw->{system_bash}||'') =~ /\A[4-9]\./) {$f{bash_family}='bash4plus'}
    if ($f{kernel} eq 'Darwin') {
        if (($raw->{translated}||'') eq '1' || ($raw->{arm64}||'') eq '1' || $f{process_arch} eq 'arm64') {$f{hardware_family}='apple_silicon'}
        elsif (($raw->{cpu_vendor}||'') eq 'GenuineIntel' && $f{process_arch} eq 'x86_64') {$f{hardware_family}='intel'}
        if (($raw->{safe_boot}||'') eq '1') { @f{qw(environment environment_confidence)}=('safe','OBSERVED') }
        elsif ($raw->{cdis} && $raw->{base_system}) { @f{qw(environment environment_confidence)}=('recovery_like','HEURISTIC_STRONG') }
        elsif ($raw->{cdis} || $raw->{base_system}) { @f{qw(environment environment_confidence)}=('installer_or_recovery','HEURISTIC_WEAK') }
        elsif ($raw->{finder} && $raw->{setup_done}) { @f{qw(environment environment_confidence)}=('full','HEURISTIC') }
    }
    # No year or shell version is inferred from the model identifier.
    return \%f;
}
sub fingerprint_tool {
    my ($path)=@_;
    return undef unless -f $path;
    my @s=stat($path); return undef if $s[7] > 33554432;
    open my $fh,'<',$path or return undef; binmode $fh;
    my $sha=Digest::SHA->new(256); $sha->addfile($fh); close $fh;
    return $sha->hexdigest;
}
sub collect {
    my ($self)=@_;
    my (%raw,%tools,%caps);
    my $kernel=$self->value(['/usr/bin/uname','-s']); $raw{kernel}=$kernel;
    $raw{process_arch}=$self->value(['/usr/bin/uname','-m']);
    $raw{kernel_release}=$self->value(['/usr/bin/uname','-r']);
    my $darwin=defined($kernel) && $kernel eq 'Darwin';
    $caps{'kernel.darwin'}={state=>$darwin?'VERIFIED':'UNSUPPORTED',evidence=>'RUNTIME_PROBE'};
    $caps{'metadata.collect'}={state=>'VERIFIED',evidence=>'RUNTIME_PROBE'};
    if ($darwin) {
        $raw{os_version}=$self->value(['/usr/bin/sw_vers','-productVersion']);
        $raw{os_build}=$self->value(['/usr/bin/sw_vers','-buildVersion']);
        for my $pair ([model_identifier=>'hw.model'],[ram_bytes=>'hw.memsize'],[cpu_vendor=>'machdep.cpu.vendor'],[cpu_brand=>'machdep.cpu.brand_string'],[translated=>'sysctl.proc_translated'],[arm64=>'hw.optional.arm64'],[safe_boot=>'kern.safeboot']) {
            $raw{$pair->[0]}=$self->value(['/usr/sbin/sysctl','-n',$pair->[1]]);
        }
        $raw{model_identifier}=undef if defined($raw{model_identifier}) && $raw{model_identifier} !~ /\A[A-Za-z][A-Za-z0-9,._-]{0,79}\z/;
        $raw{ram_bytes}=undef if defined($raw{ram_bytes}) && $raw{ram_bytes} !~ /\A[0-9]{1,15}\z/;
        for (qw(translated arm64 safe_boot)) { $raw{$_}=undef if defined($raw{$_}) && $raw{$_} !~ /\A[01]\z/ }
        $raw{cdis}=$self->exists('/System/Installation/CDIS')?1:0;
        $raw{finder}=$self->exists('/System/Library/CoreServices/Finder.app')?1:0;
        $raw{setup_done}=$self->exists('/var/db/.AppleSetupDone')?1:0;
        if ($raw{cdis} && $self->executable('/usr/sbin/diskutil')) {
            my $r=$self->probe(['/usr/sbin/diskutil','info','/']);
            $raw{base_system}=MacDiag::Runner::ok($r) && $r->{stdout} =~ /(?:Volume Name|Media Name):\s*(?:macOS|OS X) Base System\s*$/m ? 1:0;
        }
    }
    my @inventory=([bash=>'/bin/bash'],[sh=>'/bin/sh'],[zsh=>'/bin/zsh'],[perl=>'/usr/bin/perl'],[curl=>'/usr/bin/curl'],[route=>'/sbin/route'],[launchctl=>'/bin/launchctl'],[scutil=>'/usr/sbin/scutil'],[diskutil=>'/usr/sbin/diskutil'],[networkQuality=>'/usr/bin/networkQuality'],[python=>'/usr/bin/python'],[python3=>'/usr/bin/python3']);
    for my $row (@inventory) {
        my ($id,$path)=@$row;
        $tools{$id}={path=>$path,state=>$self->executable($path)?'PRESENT_UNPROBED':'MISSING',evidence=>'FILESYSTEM_OBSERVATION',version=>undef,sha256=>undef};
        next unless $tools{$id}{state} ne 'MISSING';
        # Tests may supply virtual paths; such observations never get real hashes.
        $tools{$id}{sha256}=fingerprint_tool($path) unless $self->{path_exec};
        if ($id eq 'bash' || $id eq 'zsh') {
            my $r=$self->probe([$path,'--version']);
            if (MacDiag::Runner::ok($r) && $r->{stdout} =~ /(?:version |zsh )([0-9]+\.[0-9]+(?:\.[0-9]+)?)/) {
                $tools{$id}{version}=$1;$tools{$id}{state}='VERIFIED';$tools{$id}{evidence}='RUNTIME_PROBE';
                $raw{system_bash}=$1 if $id eq 'bash';
            }
        }
        # Never execute /usr/bin/python3: it may be an Xcode installation stub.
        if ($id eq 'perl') {$tools{$id}{version}="$^V";$tools{$id}{state}='VERIFIED';$tools{$id}{evidence}='CURRENT_ENGINE'}
    }
    $caps{'bash.execute'}={state=>$tools{bash}{state} eq 'VERIFIED'?'VERIFIED':'UNKNOWN',evidence=>'RUNTIME_PROBE'};
    $caps{'curl.https_api'}={state=>'UNKNOWN',evidence=>'NOT_PROBED'};
    if ($tools{curl}{state} ne 'MISSING') {
        my $r=$self->probe(['/usr/bin/curl','-q','--version']);
        if (MacDiag::Runner::ok($r) && $r->{stdout} =~ /\Acurl ([0-9.]+)/) {
            $tools{curl}{version}=$1;$tools{curl}{state}='VERIFIED';$tools{curl}{evidence}='RUNTIME_PROBE';
            my $https=$r->{stdout} =~ /^Protocols:[^\n]*\bhttps\b/m;
            my $p=$self->probe(['/usr/bin/curl','-q','-4','--silent','--show-error','--fail','--globoff','--proto','=https','--proto-redir','=https','--max-time','15','--connect-timeout','5','--max-filesize','65536','--proxy','','--noproxy','*','--max-redirs','0','--help']);
            $caps{'curl.https_api'}={state=>$https && MacDiag::Runner::ok($p)?'VERIFIED':'UNSUPPORTED',evidence=>'LOCAL_OPTION_PROBE_NOT_NETWORK'};
        }
    }
    for my $item ([ 'route.query','route', ['/sbin/route','-n','get','-inet','127.0.0.1'],'route'],
                  [ 'dns.query','scutil',['/usr/sbin/scutil','--dns'],'dns'],
                  [ 'service.query','launchctl',['/bin/launchctl','print','system/com.apple.configd'],'service']) {
        my ($cap,$tool,$argv,$parser)=@$item;
        $caps{$cap}={state=>'UNKNOWN',evidence=>'NOT_PROBED'};
        next unless $darwin && $tools{$tool}{state} ne 'MISSING';
        my $r=$self->probe($argv);
        my $d=$parser eq 'route'?MacDiag::Adapters::route_result($r):$parser eq 'dns'?MacDiag::Adapters::dns_result($r):MacDiag::Adapters::service_result($r,'com.apple.configd');
        $caps{$cap}={state=>$d->{state} eq 'ERROR'?'UNKNOWN':'VERIFIED',evidence=>'READONLY_RUNTIME_PROBE',result=>$d};
    }
    $caps{'speed.apple'}={state=>$tools{networkQuality}{state} eq 'MISSING'?'MISSING':'PRESENT_UNPROBED',evidence=>'NO_BANDWIDTH_TEST_RUN'};
    my $facts=derive(\%raw);
    $facts->{kernel_release}=$raw{kernel_release};
    $facts->{storage_inventory}='NOT_PROBED';
    $facts->{gpu_inventory}='NOT_PROBED';
    $facts->{serviced_os}='NOT_INSPECTED';
    $facts->{privilege_class}=($> == 0 ? 'root' : 'user');
    my $engine={id=>'perl-stdlib',version=>"$^V",code_revision=>$self->{code_revision}||'unknown',dispatcher_bash=>$self->{bash_version}||'unknown',process_arch=>$facts->{process_arch},target_validation=>'NOT_VALIDATED'};
    my $identity={facts=>$facts,tools=>\%tools,engine=>$engine,registry_sha256=>$self->{registry}->hash};
    # Dynamic route/DNS state is deliberately excluded from this compatibility fingerprint.
    my $hash=sha256_hex(JSON::PP->new->canonical->utf8->encode($identity));
    return {schema=>'macdiag.profile.v1',version=>'0.1.0',collected_at=>strftime('%Y-%m-%dT%H:%M:%SZ',gmtime),
        profile_fingerprint=>$hash,registry_sha256=>$self->{registry}->hash,facts=>$facts,engine=>$engine,tools=>\%tools,
        capabilities=>\%caps,device_reference=>$self->{registry}->device($facts->{model_identifier}),selection=>$self->{registry}->resolve($facts),
        privacy=>{serial_numbers=>'NOT_COLLECTED',hardware_uuid=>'NOT_COLLECTED',usernames=>'NOT_COLLECTED',environment_dump=>'NOT_COLLECTED',network_requests=>'NONE',upload=>'NONE'},
        evidence=>'LIVE_OBSERVATION_NOT_HARDWARE_CERTIFICATION'};
}
1;
