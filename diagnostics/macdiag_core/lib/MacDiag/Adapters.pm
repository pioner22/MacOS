package MacDiag::Adapters;
use strict;
use warnings;
use MacDiag::Runner;

# All parsers are pure: no execution from a registry row or a saved snapshot.
sub route_result {
    my ($r) = @_;
    return {state => 'ERROR', reason => $r->{state}} unless $r->{state} eq 'EXECUTED' && !$r->{signal} && defined($r->{exit_code}) && $r->{exit_code} <= 1;
    my ($out,$err) = @{$r}{qw(stdout stderr)};
    my @ifaces = $out =~ /^[ \t]*interface:[ \t]*([A-Za-z][A-Za-z0-9_.-]{0,31})[ \t]*$/mg;
    my $text = lc($out . "\n" . $err);
    my $absent = qr/^[ \t]*(?:route: )?(?:writing to routing socket: (?:not in table|no such process|network (?:is )?unreachable)|message indicates error (?:3: no such process|51: network (?:is )?unreachable|65: no route to host)|(?:not in table|no such process|network (?:is )?unreachable|no route to host))[ \t]*$/m;
    if ($text =~ $absent) {
        return {state=>'ERROR',reason=>'CONTRADICTORY_OUTPUT'} if @ifaces;
        $text =~ s/$absent//mg; $text =~ s/^[ \t]*route to:[^\n]*$//mg;
        return {state=>'ERROR',reason=>'EXTRA_DIAGNOSTIC'} if $text =~ /\S/;
        return {state=>'ABSENT',reason=>'EXPLICIT_NO_ROUTE'};
    }
    return {state=>'ERROR',reason=>'UNRECOGNIZED_OUTPUT'} if $r->{exit_code} || $err =~ /\S/ || @ifaces != 1;
    my @flags = $out =~ /^[ \t]*flags:[ \t]*<([^>]+)>[ \t]*$/mg;
    return {state=>'ERROR',reason=>'FLAGS_MISSING_OR_AMBIGUOUS'} unless @flags == 1;
    my %f = map { $_ => 1 } split /,/, $flags[0];
    return {state=>'UNUSABLE',reason=>'REJECT_OR_BLACKHOLE',interface=>$ifaces[0]} if $f{REJECT} || $f{BLACKHOLE};
    return {state=>'ERROR',reason=>'ROUTE_NOT_UP'} unless $f{UP};
    return {state=>'FOUND',interface=>$ifaces[0]};
}
sub service_result {
    my ($r,$label) = @_;
    return {state=>'ERROR',reason=>$r->{state}} unless $r->{state} eq 'EXECUTED' && !$r->{signal};
    if (defined($r->{exit_code}) && $r->{exit_code} == 0 && $r->{stdout} =~ /\S/ && $r->{stderr} !~ /\S/) {
        my @pids = $r->{stdout} =~ /^\s*pid = ([0-9]+)\s*$/mg;
        return {state=>'PRESENT',process_state=>(@pids == 1 && $pids[0] > 1) ? 'RUNNING' : 'NOT_CONFIRMED'};
    }
    my $diag = lc($r->{stdout} . "\n" . $r->{stderr});
    if (defined($r->{exit_code}) && ($r->{exit_code} == 3 || $r->{exit_code} == 113) && $diag =~ /could not find service ["']?\Q$label\E["']?(?:\s|\z)/i) {
        return {state=>'ABSENT',process_state=>'ABSENT'};
    }
    return {state=>'ERROR',reason=>'SERVICE_QUERY_UNCONFIRMED'};
}
sub dns_result {
    my ($r) = @_;
    return {state=>'ERROR',reason=>'DNS_QUERY_FAILED'} unless MacDiag::Runner::ok($r);
    return {state=>'ABSENT',resolver_count=>0} if $r->{stdout} =~ /\Ano DNS configuration available\s*\z/;
    my @resolver = $r->{stdout} =~ /^resolver #[0-9]+\s*$/mg;
    return {state=>'ERROR',reason=>'DNS_FORMAT_UNKNOWN'} unless @resolver;
    my @servers = $r->{stdout} =~ /^\s*nameserver\[[0-9]+\]\s*:\s*\S+/mg;
    return {state=>'OBSERVED',resolver_count=>scalar(@resolver),server_entries=>scalar(@servers),leak_audit=>'NOT_PERFORMED'};
}
sub ipv4 {
    my ($s) = @_;
    return undef unless defined($s) && $s =~ /\A([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\z/;
    my @v=($1,$2,$3,$4);
    return undef if grep { $_ > 255 || (length($_)>1 && /^0/) } @v;
    return join('.', @v);
}
sub curl_result {
    my ($r,$ip) = @_;
    return {state=>'ERROR',reason=>$r->{state},exit_code=>$r->{exit_code}} unless MacDiag::Runner::ok($r);
    my $out = $r->{stdout};
    return {state=>'ERROR',reason=>'HTTP_METRICS_MISSING'} unless $out =~ s/\n__MACDIAG_HTTP__(\d{3})\t([^\s]+)\s*\z//;
    my ($code,$peer)=($1,$2);
    return {state=>'FAIL',reason=>'HTTP_STATUS',http=>0+$code} unless $code eq '200';
    return {state=>'ERROR',reason=>'PEER_NOT_IPV4'} unless defined ipv4($peer);
    my $data = {state=>'PASS',http=>200,peer=>$peer,tls=>'CURL_VERIFIED',scope=>'THIS_HTTPS_ENDPOINT_ONLY'};
    if ($ip) {
        $out =~ s/\A\s+|\s+\z//g;
        my $address=ipv4($out);
        return {state=>'ERROR',reason=>'IP_RESPONSE_INVALID'} unless defined $address;
        $data->{external_ipv4}=$address;
        $data->{vpn_proof}='NOT_PROVEN_BY_IP_ALONE';
    }
    return $data;
}
sub run_module {
    my ($id,$runner,$snapshot,%opt) = @_;
    return {state=>'PASS',scope=>'METADATA_NOT_HEALTH',facts=>$snapshot->{facts}} if $id eq 'system.inventory';
    return {state=>'PASS',scope=>'INVENTORY_NOT_HEALTH',tools=>$snapshot->{tools}} if $id eq 'tools.inventory';
    if ($id eq 'network.routes') {
        my @rows;
        for my $spec (['1.1.1.1','-inet'],['208.67.222.222','-inet'],['2606:4700:4700::1111','-inet6'],['8000::1','-inet6']) {
            my $result=route_result($runner->run(['/sbin/route','-n','get',$spec->[1],$spec->[0]],timeout=>5));
            push @rows, {address=>$spec->[0],%$result};
        }
        my $failed=grep {$_->{state} eq 'ERROR'} @rows;
        return {state=>$failed ? 'ERROR':'PASS',scope=>'ROUTE_OBSERVATION_NOT_VPN_PROOF',routes=>\@rows};
    }
    if ($id eq 'network.dns') {
        my $d=dns_result($runner->run(['/usr/sbin/scutil','--dns'],timeout=>5));
        return {state=>($d->{state} eq 'ERROR'?'ERROR':'PASS'),dns=>$d};
    }
    if ($id eq 'service.inventory') {
        my $label=$opt{service} || 'ru.pioner22.bigsur-vpn';
        die "SERVICE_LABEL_INVALID\n" unless $label =~ /\A[A-Za-z0-9][A-Za-z0-9_.-]{0,119}\z/;
        my $s=service_result($runner->run(['/bin/launchctl','print','system/'.$label],timeout=>5),$label);
        return {state=>$s->{state} eq 'ERROR'?'ERROR':'PASS',scope=>'OBSERVATION_NOT_VPN_PROOF',service_label=>$label,service=>$s};
    }
    if ($id eq 'network.internet' || $id eq 'network.ip') {
        die "NETWORK_CONSENT_REQUIRED\n" unless $opt{allow_network};
        my $url=$id eq 'network.ip' ? 'https://ifconfig.me/ip' : 'https://github.com/robots.txt';
        my $r=$runner->run(['/usr/bin/curl','-q','-4','--silent','--show-error','--fail','--globoff',
            '--proto','=https','--proto-redir','=https','--max-time','15','--connect-timeout','5',
            '--max-filesize','65536','--proxy','','--noproxy','*','--max-redirs','0',
            '--write-out',"\n__MACDIAG_HTTP__%{http_code}\t%{remote_ip}\n",$url],timeout=>18,max_bytes=>131072);
        my $c=curl_result($r,$id eq 'network.ip'); $c->{endpoint}=$url;
        return $c;
    }
    return {state=>'BLOCKED',reason=>'NOT_IMPLEMENTED'};
}
1;
